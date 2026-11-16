const assert = require('chai').assert;
const { request, app, PASSWORD, resetDb } = require('./helper');

describe('API Test: [Auth]', () => {
    const agent = request.agent(app);
    const NEW_PASSWORD = 'newpassword5678';

    before(resetDb);

    it('POST /auth/signup - 회원가입하면 기본 카테고리가 자동 생성된다', async () => {
        const res = await agent.post('/auth/signup')
            .send({ id: 'wkim', password: PASSWORD, name: '김원빈' })
            .expect(201);

        assert.equal(res.body.id, 'wkim');
        assert.notExists(res.body.password, '비밀번호는 응답에 포함되면 안 된다');

        await agent.post('/auth/login').send({ id: 'wkim', password: PASSWORD }).expect(200);
        const categories = await agent.get('/categories').expect(200);
        assert.isAbove(categories.body.length, 0);
        assert.exists(categories.body.find(category => category.name === '식비'));
        await agent.post('/auth/logout').expect(200);
    });

    it('POST /auth/signup - 이미 있는 아이디는 409', async () => {
        await request(app).post('/auth/signup')
            .send({ id: 'wkim', password: PASSWORD, name: '다른사람' })
            .expect(409);
    });

    it('POST /auth/signup - 짧은 비밀번호는 400', async () => {
        await request(app).post('/auth/signup')
            .send({ id: 'short', password: '1234', name: '짧은비번' })
            .expect(400);
    });

    it('POST /auth/login - 비밀번호가 틀리면 401', async () => {
        await request(app).post('/auth/login')
            .send({ id: 'wkim', password: 'wrong-password' })
            .expect(401);
    });

    it('GET /auth/me - 로그인하지 않으면 401', async () => {
        await request(app).get('/auth/me').expect(401);
    });

    it('POST /auth/login -> GET /auth/me - 로그인 후 내 정보 조회', async () => {
        await agent.post('/auth/login').send({ id: 'wkim', password: PASSWORD }).expect(200);

        const res = await agent.get('/auth/me').expect(200);
        assert.equal(res.body.id, 'wkim');
        assert.equal(res.body.name, '김원빈');
    });

    it('PATCH /auth/me - 내 정보 수정', async () => {
        const res = await agent.patch('/auth/me')
            .send({ name: '김원빈2', description: '가계부 사용자' })
            .expect(200);

        assert.equal(res.body.name, '김원빈2');
        assert.equal(res.body.description, '가계부 사용자');
    });

    it('PATCH /auth/me/password - 현재 비밀번호가 틀리면 400', async () => {
        await agent.patch('/auth/me/password')
            .send({ currentPassword: 'wrong-password', newPassword: NEW_PASSWORD })
            .expect(400);
    });

    it('PATCH /auth/me/password - 변경 후에는 새 비밀번호로만 로그인된다', async () => {
        await agent.patch('/auth/me/password')
            .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
            .expect(200);

        await request(app).post('/auth/login').send({ id: 'wkim', password: PASSWORD }).expect(401);
        await request(app).post('/auth/login').send({ id: 'wkim', password: NEW_PASSWORD }).expect(200);
    });

    it('POST /auth/logout - 로그아웃하면 내 정보를 볼 수 없다', async () => {
        await agent.post('/auth/logout').expect(200);
        await agent.get('/auth/me').expect(401);
    });

    it('DELETE /auth/me - 탈퇴하면 다시 로그인할 수 없다', async () => {
        await agent.post('/auth/login').send({ id: 'wkim', password: NEW_PASSWORD }).expect(200);
        await agent.delete('/auth/me').expect(200);

        await agent.get('/auth/me').expect(401);
        await request(app).post('/auth/login').send({ id: 'wkim', password: NEW_PASSWORD }).expect(401);
    });
});
