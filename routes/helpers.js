const { Op } = require('sequelize');

// ---------- 인증 ----------
exports.isLoggedIn = (req, res, next) => {
    if (req.isAuthenticated()) next();
    else res.status(401).json({ message: '로그인이 필요합니다.' });
};

// ---------- 에러 ----------
// throw fail(404, '...') 형태로 사용. app.js의 에러 처리 미들웨어가 status에 맞춰 응답한다.
const fail = (status, message) => {
    const err = new Error(message);
    err.status = status;
    return err;
};
exports.fail = fail;

// async 라우터에서 발생한 에러를 next(err)로 넘겨주는 래퍼 (try/catch 반복 제거)
exports.wrap = handler => (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

// ---------- 날짜 ----------
const pad = n => String(n).padStart(2, '0');

const isDate = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
};
exports.isDate = isDate;

const isMonth = value =>
    typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
exports.isMonth = isMonth;

const today = () => {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};
exports.today = today;

const currentMonth = () => today().slice(0, 7);
exports.currentMonth = currentMonth;

// '2026-11' -> { from: '2026-11-01', to: '2026-11-30' }
const monthRange = month => {
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return { from: `${month}-01`, to: `${month}-${pad(lastDay)}` };
};
exports.monthRange = monthRange;

// shiftMonth('2026-01', -1) -> '2025-12'
exports.shiftMonth = (month, diff) => {
    const [y, m] = month.split('-').map(Number);
    const date = new Date(y, m - 1 + diff, 1);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
};

// ?month=YYYY-MM 을 읽는다. 없으면 이번 달.
exports.parseMonth = query => {
    const month = query.month || currentMonth();
    if (!isMonth(month)) throw fail(400, 'month는 YYYY-MM 형식이어야 합니다.');
    return month;
};

// ?month=YYYY-MM 또는 ?from=YYYY-MM-DD&to=YYYY-MM-DD 를 읽어 { from, to } 로 돌려준다. (둘 다 없으면 빈 값)
const parsePeriod = query => {
    if (query.month) {
        if (!isMonth(query.month)) throw fail(400, 'month는 YYYY-MM 형식이어야 합니다.');
        return monthRange(query.month);
    }

    const { from, to } = query;
    if (from && !isDate(from)) throw fail(400, 'from은 YYYY-MM-DD 형식이어야 합니다.');
    if (to && !isDate(to)) throw fail(400, 'to는 YYYY-MM-DD 형식이어야 합니다.');
    if (from && to && from > to) throw fail(400, 'from은 to보다 늦을 수 없습니다.');
    return { from, to };
};
exports.parsePeriod = parsePeriod;

// ---------- 숫자 ----------
const isPositiveInt = value => Number.isInteger(value) && value > 0;
exports.isPositiveInt = isPositiveInt;

// 쿼리스트링의 숫자 값 (?limit=5 등). 없으면 기본값, 범위를 벗어나면 400
const parseIntQuery = (value, name, { defaultValue, min = 1, max }) => {
    if (value === undefined) return defaultValue;
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || (max && number > max))
        throw fail(400, `${name}은(는) ${min}${max ? `~${max}` : ' 이상'}의 정수여야 합니다.`);
    return number;
};
exports.parseIntQuery = parseIntQuery;

// ---------- 거래 조회 공통 ----------
// 기간, 카테고리, 결제수단, 구분, 메모 검색(q) 조건을 where 객체로 만든다.
exports.buildTransactionWhere = (userId, query) => {
    const where = { userId };

    const { from, to } = parsePeriod(query);
    if (from && to) where.date = { [Op.between]: [from, to] };
    else if (from) where.date = { [Op.gte]: from };
    else if (to) where.date = { [Op.lte]: to };

    if (query.type) {
        if (!['income', 'expense'].includes(query.type))
            throw fail(400, 'type은 income 또는 expense 여야 합니다.');
        where.type = query.type;
    }
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.accountId) where.accountId = query.accountId;
    if (query.q) where.memo = { [Op.like]: `%${query.q}%` };

    return where;
};

// ?page=1&limit=20
exports.parsePagination = query => {
    const page = parseIntQuery(query.page, 'page', { defaultValue: 1 });
    const limit = parseIntQuery(query.limit, 'limit', { defaultValue: 20, max: 100 });
    return { page, limit, offset: (page - 1) * limit };
};

// 거래 조회 시 카테고리, 결제수단 이름을 함께 가져오기 위한 include / 정렬
exports.transactionInclude = () => {
    const { Category, Account } = require('../models');
    return [
        { model: Category, attributes: ['id', 'name', 'type'] },
        { model: Account, attributes: ['id', 'name', 'type'] }
    ];
};
exports.transactionOrder = [['date', 'DESC'], ['id', 'DESC']];

// 페이지네이션이 적용된 거래 목록 응답
exports.findTransactionPage = async (where, query) => {
    const { Transaction } = require('../models');
    const { page, limit, offset } = exports.parsePagination(query);

    const { count, rows } = await Transaction.findAndCountAll({
        where,
        include: exports.transactionInclude(),
        order: exports.transactionOrder,
        limit,
        offset
    });

    return { total: count, page, limit, totalPages: Math.ceil(count / limit), items: rows };
};

// 이체를 제외한 일반 거래만 (통계, 예산 계산용)
exports.notTransfer = { transferId: null };
