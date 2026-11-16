const express = require('express');
const crypto = require('crypto');
const { fn, col, Op } = require('sequelize');

const { sequelize, Account, Transaction } = require('../models');
const {
    isLoggedIn, wrap, fail,
    isDate, today, isPositiveInt,
    buildTransactionWhere, findTransactionPage
} = require('./helpers');

const router = express.Router();
router.use(isLoggedIn);

const TYPES = ['cash', 'bank', 'card', 'etc'];

// 내 결제수단이 아니면 404
const findAccount = async (userId, id) => {
    const account = await Account.findOne({ where: { id, userId } });
    if (!account) throw fail(404, '결제수단을 찾을 수 없습니다.');
    return account;
};

const checkDuplicate = async (userId, name, exceptId) => {
    const where = { userId, name };
    if (exceptId) where.id = { [Op.ne]: exceptId };
    if (await Account.findOne({ where }))
        throw fail(409, '같은 이름의 결제수단이 이미 있습니다.');
};

// 결제수단별 (수입 - 지출) 합계를 { accountId: 금액 } 형태로 구한다. date 까지의 거래만 포함.
const sumByAccount = async (userId, date, accountId) => {
    const where = { userId, date: { [Op.lte]: date }, accountId: accountId || { [Op.ne]: null } };

    const rows = await Transaction.findAll({
        attributes: ['accountId', 'type', [fn('SUM', col('amount')), 'total']],
        where,
        group: ['accountId', 'type'],
        raw: true
    });

    const result = {};
    rows.forEach(row => {
        const sign = row.type === 'income' ? 1 : -1;
        result[row.accountId] = (result[row.accountId] || 0) + sign * Number(row.total);
    });
    return result;
};

router.route('/')
    // POST /accounts - 결제수단 등록
    .post(wrap(async (req, res) => {
        const { name, type = 'bank', initialBalance = 0 } = req.body;

        if (!name || typeof name !== 'string') throw fail(400, 'name은 필수입니다.');
        if (!TYPES.includes(type)) throw fail(400, `type은 ${TYPES.join(', ')} 중 하나여야 합니다.`);
        if (!Number.isInteger(initialBalance)) throw fail(400, 'initialBalance는 정수여야 합니다.');
        await checkDuplicate(req.user.id, name);

        const account = await Account.create({ name, type, initialBalance, userId: req.user.id });
        res.status(201).json(account);
    }))
    // GET /accounts - 목록 조회 (현재 잔액 포함)
    .get(wrap(async (req, res) => {
        const accounts = await Account.findAll({
            where: { userId: req.user.id },
            order: [['id', 'ASC']]
        });
        const sums = await sumByAccount(req.user.id, today());

        res.json(accounts.map(account => ({
            ...account.toJSON(),
            balance: account.initialBalance + (sums[account.id] || 0)
        })));
    }));

// POST /accounts/transfer - 계좌 간 이체 (출금과 입금을 한 트랜잭션으로 처리)
router.post('/transfer', wrap(async (req, res) => {
    const { fromAccountId, toAccountId, amount, date = today(), memo } = req.body;
    const userId = req.user.id;

    if (!fromAccountId || !toAccountId) throw fail(400, 'fromAccountId와 toAccountId는 필수입니다.');
    if (Number(fromAccountId) === Number(toAccountId)) throw fail(400, '같은 결제수단으로는 이체할 수 없습니다.');
    if (!isPositiveInt(amount)) throw fail(400, 'amount는 1 이상의 정수여야 합니다.');
    if (!isDate(date)) throw fail(400, 'date는 YYYY-MM-DD 형식이어야 합니다.');

    const from = await findAccount(userId, fromAccountId);
    const to = await findAccount(userId, toAccountId);

    const transferId = crypto.randomUUID();
    const common = { userId, amount, date, transferId };

    // 출금만 되고 입금이 안 되는 일이 없도록 두 건을 한 트랜잭션으로 묶는다.
    const [withdrawal, deposit] = await sequelize.transaction(async t => [
        await Transaction.create({
            ...common, type: 'expense', accountId: from.id,
            memo: memo || `${to.name}(으)로 이체`
        }, { transaction: t }),
        await Transaction.create({
            ...common, type: 'income', accountId: to.id,
            memo: memo || `${from.name}에서 이체`
        }, { transaction: t })
    ]);

    res.status(201).json({ transferId, withdrawal, deposit });
}));

router.route('/:id')
    // PATCH /accounts/:id - 수정
    .patch(wrap(async (req, res) => {
        const account = await findAccount(req.user.id, req.params.id);
        const { name, type, initialBalance } = req.body;

        if (name === undefined && type === undefined && initialBalance === undefined)
            throw fail(400, '수정할 내용이 없습니다.');
        if (name !== undefined) {
            if (!name || typeof name !== 'string') throw fail(400, 'name은 비워둘 수 없습니다.');
            await checkDuplicate(req.user.id, name, account.id);
            account.name = name;
        }
        if (type !== undefined) {
            if (!TYPES.includes(type)) throw fail(400, `type은 ${TYPES.join(', ')} 중 하나여야 합니다.`);
            account.type = type;
        }
        if (initialBalance !== undefined) {
            if (!Number.isInteger(initialBalance)) throw fail(400, 'initialBalance는 정수여야 합니다.');
            account.initialBalance = initialBalance;
        }

        await account.save();
        res.json(account);
    }))
    // DELETE /accounts/:id - 삭제 (거래 연결 시 차단)
    .delete(wrap(async (req, res) => {
        const account = await findAccount(req.user.id, req.params.id);

        const count = await Transaction.count({ where: { accountId: account.id } });
        if (count) throw fail(409, `이 결제수단에 연결된 거래가 ${count}건 있어 삭제할 수 없습니다.`);

        await account.destroy();
        res.json({ message: '결제수단이 삭제되었습니다.' });
    }));

// GET /accounts/:id/balance - 특정 시점 잔액 계산 (?date=YYYY-MM-DD, 없으면 오늘)
router.get('/:id/balance', wrap(async (req, res) => {
    const account = await findAccount(req.user.id, req.params.id);

    const date = req.query.date || today();
    if (!isDate(date)) throw fail(400, 'date는 YYYY-MM-DD 형식이어야 합니다.');

    const sums = await sumByAccount(req.user.id, date, account.id);

    res.json({
        accountId: account.id,
        name: account.name,
        date,
        initialBalance: account.initialBalance,
        balance: account.initialBalance + (sums[account.id] || 0)
    });
}));

// GET /accounts/:id/transactions - 해당 결제수단 거래 목록 (기간, 페이지네이션)
router.get('/:id/transactions', wrap(async (req, res) => {
    const account = await findAccount(req.user.id, req.params.id);

    const where = buildTransactionWhere(req.user.id, { ...req.query, accountId: account.id });
    res.json(await findTransactionPage(where, req.query));
}));

module.exports = router;
