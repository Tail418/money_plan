const express = require('express');
const { fn, col, Op } = require('sequelize');

const { Category, Transaction } = require('../models');
const {
    isLoggedIn, wrap, fail,
    parsePeriod, buildTransactionWhere, findTransactionPage, notTransfer
} = require('./helpers');

const router = express.Router();
router.use(isLoggedIn);

const TYPES = ['income', 'expense'];

// 내 카테고리가 아니면 404
const findCategory = async req => {
    const category = await Category.findOne({
        where: { id: req.params.id, userId: req.user.id }
    });
    if (!category) throw fail(404, '카테고리를 찾을 수 없습니다.');
    return category;
};

const checkDuplicate = async (userId, name, type, exceptId) => {
    const where = { userId, name, type };
    if (exceptId) where.id = { [Op.ne]: exceptId };
    if (await Category.findOne({ where }))
        throw fail(409, '같은 구분에 같은 이름의 카테고리가 이미 있습니다.');
};

router.route('/')
    // POST /categories - 생성 (수입/지출 구분)
    .post(wrap(async (req, res) => {
        const { name, type } = req.body;

        if (!name || typeof name !== 'string') throw fail(400, 'name은 필수입니다.');
        if (!TYPES.includes(type)) throw fail(400, 'type은 income 또는 expense 여야 합니다.');
        await checkDuplicate(req.user.id, name, type);

        const category = await Category.create({ name, type, userId: req.user.id });
        res.status(201).json(category);
    }))
    // GET /categories - 목록 조회 (?type=income|expense)
    .get(wrap(async (req, res) => {
        const where = { userId: req.user.id };

        if (req.query.type) {
            if (!TYPES.includes(req.query.type)) throw fail(400, 'type은 income 또는 expense 여야 합니다.');
            where.type = req.query.type;
        }

        const categories = await Category.findAll({ where, order: [['type', 'ASC'], ['id', 'ASC']] });
        res.json(categories);
    }));

router.route('/:id')
    // PATCH /categories/:id - 수정
    .patch(wrap(async (req, res) => {
        const category = await findCategory(req);
        const { name, type } = req.body;

        if (name === undefined && type === undefined) throw fail(400, '수정할 내용이 없습니다.');
        if (name !== undefined && (!name || typeof name !== 'string')) throw fail(400, 'name은 비워둘 수 없습니다.');

        if (type !== undefined && type !== category.type) {
            if (!TYPES.includes(type)) throw fail(400, 'type은 income 또는 expense 여야 합니다.');
            // 이미 거래가 연결된 카테고리의 구분을 바꾸면 거래의 구분과 어긋난다.
            if (await Transaction.count({ where: { categoryId: category.id } }))
                throw fail(409, '거래가 연결된 카테고리는 구분을 바꿀 수 없습니다.');
        }

        const next = { name: name ?? category.name, type: type ?? category.type };
        await checkDuplicate(req.user.id, next.name, next.type, category.id);

        await category.update(next);
        res.json(category);
    }))
    // DELETE /categories/:id - 삭제 (거래 연결 시 차단)
    .delete(wrap(async (req, res) => {
        const category = await findCategory(req);

        const count = await Transaction.count({ where: { categoryId: category.id } });
        if (count) throw fail(409, `이 카테고리에 연결된 거래가 ${count}건 있어 삭제할 수 없습니다.`);

        await category.destroy();
        res.json({ message: '카테고리가 삭제되었습니다.' });
    }));

// GET /categories/:id/transactions - 해당 카테고리 거래 목록 (기간, 페이지네이션)
router.get('/:id/transactions', wrap(async (req, res) => {
    const category = await findCategory(req);

    const where = buildTransactionWhere(req.user.id, { ...req.query, categoryId: category.id });
    res.json(await findTransactionPage(where, req.query));
}));

// GET /categories/:id/summary - 기간별 합계와 거래 건수 (?month= 또는 ?from=&to=)
router.get('/:id/summary', wrap(async (req, res) => {
    const category = await findCategory(req);
    const { from, to } = parsePeriod(req.query);

    const where = buildTransactionWhere(req.user.id, { from, to, categoryId: category.id });
    const [row] = await Transaction.findAll({
        attributes: [
            [fn('COALESCE', fn('SUM', col('amount')), 0), 'total'],
            [fn('COUNT', col('id')), 'count']
        ],
        where: { ...where, ...notTransfer },
        raw: true
    });

    res.json({
        categoryId: category.id,
        name: category.name,
        type: category.type,
        from: from || null,
        to: to || null,
        total: Number(row.total),
        count: Number(row.count)
    });
}));

module.exports = router;
