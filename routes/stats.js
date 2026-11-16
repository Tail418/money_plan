const express = require('express');
const { fn, col, Op } = require('sequelize');

const { Transaction, Category, Account } = require('../models');
const {
    isLoggedIn, wrap, fail,
    parseMonth, monthRange, shiftMonth, currentMonth, parseIntQuery, notTransfer
} = require('./helpers');

const router = express.Router();
router.use(isLoggedIn);

// 통계는 모두 이체를 제외한 일반 거래만 대상으로 한다.
const monthWhere = (userId, month) => {
    const { from, to } = monthRange(month);
    return { userId, date: { [Op.between]: [from, to] }, ...notTransfer };
};

const sumAmount = [fn('SUM', col('amount')), 'total'];

// 한 달의 총수입, 총지출, 잔액
const monthlySummary = async (userId, month) => {
    const rows = await Transaction.findAll({
        attributes: ['type', sumAmount],
        where: monthWhere(userId, month),
        group: ['type'],
        raw: true
    });

    const totals = { income: 0, expense: 0 };
    rows.forEach(row => { totals[row.type] = Number(row.total); });

    return { month, income: totals.income, expense: totals.expense, balance: totals.income - totals.expense };
};

// GET /stats/monthly - 월 총수입, 총지출, 잔액 (?month=, 없으면 이번 달)
router.get('/monthly', wrap(async (req, res) => {
    res.json(await monthlySummary(req.user.id, parseMonth(req.query)));
}));

// GET /stats/daily - 일별 지출 (달력용). 거래가 있는 날만 돌려준다.
router.get('/daily', wrap(async (req, res) => {
    const month = parseMonth(req.query);

    const rows = await Transaction.findAll({
        attributes: ['date', 'type', sumAmount],
        where: monthWhere(req.user.id, month),
        group: ['date', 'type'],
        order: [['date', 'ASC']],
        raw: true
    });

    const days = {};
    rows.forEach(row => {
        days[row.date] = days[row.date] || { date: row.date, income: 0, expense: 0 };
        days[row.date][row.type] = Number(row.total);
    });

    res.json({ month, days: Object.values(days) });
}));

// GET /stats/by-category - 카테고리별 비중 (?month=, ?type=expense|income 기본 expense)
router.get('/by-category', wrap(async (req, res) => {
    const month = parseMonth(req.query);
    const type = req.query.type || 'expense';
    if (!['income', 'expense'].includes(type)) throw fail(400, 'type은 income 또는 expense 여야 합니다.');

    const rows = await Transaction.findAll({
        attributes: ['categoryId', sumAmount, [fn('COUNT', col('Transaction.id')), 'count']],
        where: { ...monthWhere(req.user.id, month), type },
        include: { model: Category, attributes: ['name'] },
        group: ['categoryId', 'Category.id'],
        raw: true
    });

    const total = rows.reduce((sum, row) => sum + Number(row.total), 0);

    res.json({
        month,
        type,
        total,
        items: rows
            .map(row => ({
                categoryId: row.categoryId,
                name: row['Category.name'],
                total: Number(row.total),
                count: Number(row.count),
                ratio: Math.round(Number(row.total) / total * 1000) / 10   // 비중(%)
            }))
            .sort((a, b) => b.total - a.total)
    });
}));

// GET /stats/trend - 최근 N개월 추이 (?months=6, 이번 달 포함)
router.get('/trend', wrap(async (req, res) => {
    const months = parseIntQuery(req.query.months, 'months', { defaultValue: 6, max: 24 });

    const result = [];
    for (let i = months - 1; i >= 0; i--)
        result.push(await monthlySummary(req.user.id, shiftMonth(currentMonth(), -i)));

    res.json(result);
}));

// GET /stats/top-expenses - 지출 상위 N건 (?month=, ?limit=5)
router.get('/top-expenses', wrap(async (req, res) => {
    const month = parseMonth(req.query);
    const limit = parseIntQuery(req.query.limit, 'limit', { defaultValue: 5, max: 50 });

    const transactions = await Transaction.findAll({
        where: { ...monthWhere(req.user.id, month), type: 'expense' },
        include: [
            { model: Category, attributes: ['id', 'name'] },
            { model: Account, attributes: ['id', 'name'] }
        ],
        order: [['amount', 'DESC'], ['date', 'DESC'], ['id', 'DESC']],
        limit
    });

    res.json(transactions);
}));

// GET /stats/by-account - 결제수단별 사용액 (?month=)
router.get('/by-account', wrap(async (req, res) => {
    const month = parseMonth(req.query);

    const rows = await Transaction.findAll({
        attributes: ['accountId', sumAmount, [fn('COUNT', col('Transaction.id')), 'count']],
        where: { ...monthWhere(req.user.id, month), type: 'expense' },
        include: { model: Account, attributes: ['name'] },
        group: ['accountId', 'Account.id'],
        raw: true
    });

    res.json({
        month,
        items: rows
            .map(row => ({
                accountId: row.accountId,
                name: row['Account.name'] || '(결제수단 없음)',
                total: Number(row.total),
                count: Number(row.count)
            }))
            .sort((a, b) => b.total - a.total)
    });
}));

module.exports = router;
