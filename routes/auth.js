const express = require('express');
const passport = require('passport');
const bcrypt = require('bcrypt');

const { sequelize, User, Category, Account, Transaction, Budget } = require('../models');
const { isLoggedIn, wrap, fail } = require('./helpers');

const router = express.Router();

// 회원가입 시 자동으로 만들어 주는 기본 카테고리
const DEFAULT_CATEGORIES = [
    { name: '식비', type: 'expense' },
    { name: '교통', type: 'expense' },
    { name: '주거/통신', type: 'expense' },
    { name: '쇼핑', type: 'expense' },
    { name: '문화/여가', type: 'expense' },
    { name: '의료/건강', type: 'expense' },
    { name: '기타', type: 'expense' },
    { name: '월급', type: 'income' },
    { name: '용돈', type: 'income' },
    { name: '기타수입', type: 'income' }
];

const MIN_PASSWORD_LENGTH = 8;

const publicUser = user => ({
    id: user.id,
    name: user.name,
    description: user.description,
    createdAt: user.createdAt
});

const checkPassword = password => {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH)
        throw fail(400, `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`);
};

// POST /auth/signup - 회원가입 (기본 카테고리 자동 생성)
router.post('/signup', wrap(async (req, res) => {
    const { id, password, name, description } = req.body;

    if (!id || typeof id !== 'string') throw fail(400, 'id는 필수입니다.');
    if (!name || typeof name !== 'string') throw fail(400, 'name은 필수입니다.');
    checkPassword(password);

    if (await User.findOne({ where: { id } }))
        throw fail(409, '이미 등록된 사용자 아이디입니다.');

    const hash = await bcrypt.hash(password, 12);

    // 사용자와 기본 카테고리는 함께 만들어지거나 함께 실패해야 한다.
    const user = await sequelize.transaction(async t => {
        const created = await User.create({ id, password: hash, name, description }, { transaction: t });
        await Category.bulkCreate(
            DEFAULT_CATEGORIES.map(category => ({ ...category, userId: id })),
            { transaction: t }
        );
        return created;
    });

    res.status(201).json(publicUser(user));
}));

// POST /auth/login - 로그인
router.post('/login', (req, res, next) => {
    passport.authenticate('local', (authError, user, info) => {
        if (authError) return next(authError);
        if (!user) return next(fail(401, (info && info.message) || '로그인에 실패했습니다.'));

        req.login(user, loginError => {
            if (loginError) return next(loginError);
            res.json(publicUser(user));
        });
    })(req, res, next);
});

const destroySession = (req, res, body) => {
    req.logout();
    req.session.destroy(() => {
        res.clearCookie('session-cookie');
        res.json(body);
    });
};

// POST /auth/logout - 로그아웃
router.post('/logout', isLoggedIn, (req, res) => {
    destroySession(req, res, { message: '로그아웃 되었습니다.' });
});

router.route('/me')
    // GET /auth/me - 내 정보 조회
    .get(isLoggedIn, (req, res) => {
        res.json(publicUser(req.user));
    })
    // PATCH /auth/me - 내 정보 수정 (이름, 소개)
    .patch(isLoggedIn, wrap(async (req, res) => {
        const { name, description } = req.body;

        if (name === undefined && description === undefined)
            throw fail(400, '수정할 내용이 없습니다.');
        if (name !== undefined && (!name || typeof name !== 'string'))
            throw fail(400, 'name은 비워둘 수 없습니다.');

        if (name !== undefined) req.user.name = name;
        if (description !== undefined) req.user.description = description;
        await req.user.save();

        res.json(publicUser(req.user));
    }))
    // DELETE /auth/me - 회원 탈퇴 (내 데이터 전부 삭제 후 로그아웃)
    .delete(isLoggedIn, wrap(async (req, res) => {
        const userId = req.user.id;

        // 거래 -> 예산 -> 카테고리/결제수단 -> 사용자 순서로 지워야 외래키 제약에 걸리지 않는다.
        await sequelize.transaction(async t => {
            const options = { where: { userId }, transaction: t };
            await Transaction.destroy(options);
            await Budget.destroy(options);
            await Category.destroy(options);
            await Account.destroy(options);
            await User.destroy({ where: { id: userId }, transaction: t });
        });

        destroySession(req, res, { message: '회원 탈퇴가 완료되었습니다.' });
    }));

// PATCH /auth/me/password - 비밀번호 변경
router.patch('/me/password', isLoggedIn, wrap(async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (typeof currentPassword !== 'string' || !await bcrypt.compare(currentPassword, req.user.password))
        throw fail(400, '현재 비밀번호가 일치하지 않습니다.');
    checkPassword(newPassword);

    req.user.password = await bcrypt.hash(newPassword, 12);
    await req.user.save();

    res.json({ message: '비밀번호가 변경되었습니다.' });
}));

module.exports = router;
