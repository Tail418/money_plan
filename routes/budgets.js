const express = require('express');
const { fn, col, Op } = require('sequelize');

const { sequelize, Budget, Category, Transaction } = require('../models');
const {
    isLoggedIn, wrap, fail,
    isMonth, isPositiveInt, parseMonth, monthRange, shiftMonth, notTransfer
} = require('./helpers');

const router = express.Router();
router.use(isLoggedIn);

const ALERT_RATE = 80;   // 이 비율(%) 이상 쓰면 경고

const categoryInclude = { model: Category, attributes: ['id', 'name'] };

// 내 예산이 아니면 404
const findBudget = async req => {
    const budget = await Budget.findOne({
        where: { id: req.params.id, userId: req.user.id },
        include: categoryInclude
    });
    if (!budget) throw fail(404, '예산을 찾을 수 없습니다.');
    return budget;
};

// 해당 월의 예산마다 실제 지출을 붙여서 돌려준다.
const getStatus = async (userId, month) => {
    const budgets = await Budget.findAll({
        where: { userId, month },
        include: categoryInclude,
        order: [['id', 'ASC']]
    });

    const { from, to } = monthRange(month);
    const rows = await Transaction.findAll({
        attributes: ['categoryId', [fn('SUM', col('amount')), 'total']],
        where: { userId, type: 'expense', date: { [Op.between]: [from, to] }, ...notTransfer },
        group: ['categoryId'],
        raw: true
    });
    const spentByCategory = {};
    rows.forEach(row => { spentByCategory[row.categoryId] = Number(row.total); });

    return budgets.map(budget => {
        const spent = spentByCategory[budget.categoryId] || 0;
        return {
            id: budget.id,
            month: budget.month,
            categoryId: budget.categoryId,
            categoryName: budget.Category.name,
            amount: budget.amount,
            spent,
            remaining: budget.amount - spent,
            rate: Math.round(spent / budget.amount * 1000) / 10   // 소진율(%), 소수 첫째 자리
        };
    });
};

router.route('/')
    // POST /budgets - 예산 설정 (월, 카테고리, 금액)
    .post(wrap(async (req, res) => {
        const { month, categoryId, amount } = req.body;
        const userId = req.user.id;

        if (!isMonth(month)) throw fail(400, 'month는 YYYY-MM 형식이어야 합니다.');
        if (!isPositiveInt(amount)) throw fail(400, 'amount는 1 이상의 정수여야 합니다.');
        if (!categoryId) throw fail(400, 'categoryId는 필수입니다.');

        const category = await Category.findOne({ where: { id: categoryId, userId } });
        if (!category) throw fail(400, '존재하지 않는 카테고리입니다.');
        if (category.type !== 'expense') throw fail(400, '예산은 지출 카테고리에만 설정할 수 있습니다.');

        if (await Budget.findOne({ where: { userId, month, categoryId: category.id } }))
            throw fail(409, '해당 월에 이 카테고리의 예산이 이미 있습니다.');

        const budget = await Budget.create({ userId, month, categoryId: category.id, amount });
        res.status(201).json(budget);
    }))
    // GET /budgets - 목록 조회 (?month=2026-11, 없으면 전체)
    .get(wrap(async (req, res) => {
        const where = { userId: req.user.id };

        if (req.query.month) {
            if (!isMonth(req.query.month)) throw fail(400, 'month는 YYYY-MM 형식이어야 합니다.');
            where.month = req.query.month;
        }

        const budgets = await Budget.findAll({
            where,
            include: categoryInclude,
            order: [['month', 'DESC'], ['id', 'ASC']]
        });
        res.json(budgets);
    }));

// GET /budgets/status - 예산 대비 지출 소진율 (?month=, 없으면 이번 달)
router.get('/status', wrap(async (req, res) => {
    const month = parseMonth(req.query);
    const items = await getStatus(req.user.id, month);

    const amount = items.reduce((sum, item) => sum + item.amount, 0);
    const spent = items.reduce((sum, item) => sum + item.spent, 0);

    res.json({
        month,
        total: {
            amount,
            spent,
            remaining: amount - spent,
            rate: amount ? Math.round(spent / amount * 1000) / 10 : 0
        },
        items
    });
}));

// GET /budgets/alerts - 초과 또는 80% 이상 소진된 예산 목록 (?month=, 없으면 이번 달)
router.get('/alerts', wrap(async (req, res) => {
    const month = parseMonth(req.query);
    const items = await getStatus(req.user.id, month);

    res.json(items
        .filter(item => item.rate >= ALERT_RATE)
        .map(item => ({ ...item, level: item.spent > item.amount ? 'exceeded' : 'warning' }))
        .sort((a, b) => b.rate - a.rate));
}));

// POST /budgets/copy-previous - 전월 예산을 이번 달로 복사
// body.month(없으면 이번 달)의 바로 전 달 예산을 복사한다. 이미 예산이 있는 카테고리는 건너뛴다.
router.post('/copy-previous', wrap(async (req, res) => {
    const month = parseMonth(req.body);
    const previousMonth = shiftMonth(month, -1);
    const userId = req.user.id;

    const previous = await Budget.findAll({ where: { userId, month: previousMonth } });
    if (previous.length === 0) throw fail(404, `${previousMonth}에 설정된 예산이 없습니다.`);

    const existing = await Budget.findAll({ where: { userId, month } });
    const existingCategoryIds = new Set(existing.map(budget => budget.categoryId));

    const targets = previous.filter(budget => !existingCategoryIds.has(budget.categoryId));

    const items = await sequelize.transaction(t =>
        Budget.bulkCreate(
            targets.map(budget => ({ userId, month, categoryId: budget.categoryId, amount: budget.amount })),
            { transaction: t }
        ));

    res.status(201).json({
        month,
        from: previousMonth,
        copied: items.length,
        skipped: previous.length - items.length,
        items
    });
}));

router.route('/:id')
    // PATCH /budgets/:id - 금액 수정
    .patch(wrap(async (req, res) => {
        const budget = await findBudget(req);

        if (!isPositiveInt(req.body.amount)) throw fail(400, 'amount는 1 이상의 정수여야 합니다.');

        await budget.update({ amount: req.body.amount });
        res.json(budget);
    }))
    // DELETE /budgets/:id - 삭제
    .delete(wrap(async (req, res) => {
        const budget = await findBudget(req);
        await budget.destroy();
        res.json({ message: '예산이 삭제되었습니다.' });
    }));

module.exports = router;
