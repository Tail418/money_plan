const express = require('express');

const { sequelize, Transaction, Category, Account } = require('../models');
const {
    isLoggedIn, wrap, fail,
    isDate, today, isPositiveInt, parseIntQuery,
    buildTransactionWhere, findTransactionPage, transactionInclude, transactionOrder
} = require('./helpers');

const router = express.Router();
router.use(isLoggedIn);

const TYPE_LABEL = { income: '수입', expense: '지출' };

// 요청 본문을 검사해서 저장할 값으로 만든다. 잘못된 값이면 400.
// label은 일괄 등록에서 몇 번째 항목이 잘못됐는지 알려주기 위한 접두어.
const validate = async (userId, body, label = '') => {
    const { type, amount, date = today(), categoryId, accountId = null, memo = null } = body;

    if (!TYPE_LABEL[type]) throw fail(400, `${label}type은 income 또는 expense 여야 합니다.`);
    if (!isPositiveInt(amount)) throw fail(400, `${label}amount는 1 이상의 정수여야 합니다.`);
    if (!isDate(date)) throw fail(400, `${label}date는 YYYY-MM-DD 형식이어야 합니다.`);
    if (memo !== null && (typeof memo !== 'string' || memo.length > 200))
        throw fail(400, `${label}memo는 200자 이하의 문자열이어야 합니다.`);

    if (!categoryId) throw fail(400, `${label}categoryId는 필수입니다.`);
    const category = await Category.findOne({ where: { id: categoryId, userId } });
    if (!category) throw fail(400, `${label}존재하지 않는 카테고리입니다.`);
    if (category.type !== type)
        throw fail(400, `${label}${TYPE_LABEL[type]} 거래에는 ${TYPE_LABEL[type]} 카테고리만 사용할 수 있습니다.`);

    if (accountId !== null && !await Account.findOne({ where: { id: accountId, userId } }))
        throw fail(400, `${label}존재하지 않는 결제수단입니다.`);

    return { userId, type, amount, date, categoryId: category.id, accountId, memo };
};

// 내 거래가 아니면 404
const findTransaction = async req => {
    const transaction = await Transaction.findOne({
        where: { id: req.params.id, userId: req.user.id },
        include: transactionInclude()
    });
    if (!transaction) throw fail(404, '거래를 찾을 수 없습니다.');
    return transaction;
};

router.route('/')
    // POST /transactions - 거래 등록
    .post(wrap(async (req, res) => {
        const values = await validate(req.user.id, req.body);
        const transaction = await Transaction.create(values);
        res.status(201).json(transaction);
    }))
    // GET /transactions - 목록 조회 (기간, 카테고리, 구분, 메모 검색 ?q=, 페이지네이션)
    .get(wrap(async (req, res) => {
        const where = buildTransactionWhere(req.user.id, req.query);
        res.json(await findTransactionPage(where, req.query));
    }));

// POST /transactions/bulk - 여러 건 일괄 등록 (하나라도 잘못되면 전부 등록하지 않는다)
router.post('/bulk', wrap(async (req, res) => {
    const { transactions } = req.body;

    if (!Array.isArray(transactions) || transactions.length === 0)
        throw fail(400, 'transactions는 1건 이상의 배열이어야 합니다.');
    if (transactions.length > 100)
        throw fail(400, '한 번에 100건까지만 등록할 수 있습니다.');

    const values = [];
    for (let i = 0; i < transactions.length; i++)
        values.push(await validate(req.user.id, transactions[i] || {}, `${i + 1}번째 항목: `));

    const items = await sequelize.transaction(t =>
        Transaction.bulkCreate(values, { transaction: t }));

    res.status(201).json({ count: items.length, items });
}));

// GET /transactions/recent - 최근 거래 N건 (?limit=5)
router.get('/recent', wrap(async (req, res) => {
    const limit = parseIntQuery(req.query.limit, 'limit', { defaultValue: 5, max: 50 });

    const transactions = await Transaction.findAll({
        where: { userId: req.user.id },
        include: transactionInclude(),
        order: transactionOrder,
        limit
    });
    res.json(transactions);
}));

// CSV 한 칸. 쉼표/따옴표/줄바꿈을 감싸고, 엑셀에서 수식으로 실행될 수 있는 값은 작은따옴표로 막는다.
const csvCell = value => {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// GET /transactions/export - CSV 내보내기 (목록 조회와 같은 필터 사용)
router.get('/export', wrap(async (req, res) => {
    const where = buildTransactionWhere(req.user.id, req.query);

    const transactions = await Transaction.findAll({
        where,
        include: transactionInclude(),
        order: transactionOrder
    });

    const lines = [
        ['날짜', '구분', '카테고리', '결제수단', '금액', '메모'].join(','),
        ...transactions.map(t => [
            csvCell(t.date),
            csvCell(t.transferId ? '이체' : TYPE_LABEL[t.type]),
            csvCell(t.Category ? t.Category.name : ''),
            csvCell(t.Account ? t.Account.name : ''),
            // 금액은 숫자 그대로 내보낸다 (이체 출금은 음수로 표시)
            t.transferId && t.type === 'expense' ? -t.amount : t.amount,
            csvCell(t.memo)
        ].join(','))
    ];

    res.set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="transactions.csv"'
    });
    // 엑셀에서 한글이 깨지지 않도록 BOM을 붙인다.
    res.send('﻿' + lines.join('\n') + '\n');
}));

router.route('/:id')
    // GET /transactions/:id - 상세 조회
    .get(wrap(async (req, res) => {
        res.json(await findTransaction(req));
    }))
    // PATCH /transactions/:id - 수정 (보낸 항목만 변경)
    .patch(wrap(async (req, res) => {
        const transaction = await findTransaction(req);

        if (transaction.transferId)
            throw fail(400, '이체 거래는 수정할 수 없습니다. 삭제 후 다시 이체해 주세요.');

        const fields = ['type', 'amount', 'date', 'categoryId', 'accountId', 'memo'];
        if (!fields.some(field => req.body[field] !== undefined))
            throw fail(400, '수정할 내용이 없습니다.');

        // 기존 값에 보낸 값을 덮어쓴 뒤 전체를 다시 검사한다.
        const merged = {};
        fields.forEach(field => {
            merged[field] = req.body[field] !== undefined ? req.body[field] : transaction[field];
        });

        const { userId, ...values } = await validate(req.user.id, merged);
        await transaction.update(values);
        res.json(await findTransaction(req));
    }))
    // DELETE /transactions/:id - 삭제 (이체 거래는 짝이 되는 거래도 함께 삭제)
    .delete(wrap(async (req, res) => {
        const transaction = await findTransaction(req);

        if (transaction.transferId) {
            await Transaction.destroy({
                where: { userId: req.user.id, transferId: transaction.transferId }
            });
            return res.json({ message: '이체 거래(출금, 입금)가 함께 삭제되었습니다.' });
        }

        await transaction.destroy();
        res.json({ message: '거래가 삭제되었습니다.' });
    }));

module.exports = router;
