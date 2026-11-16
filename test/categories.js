const assert = require('chai').assert;
const { request, app, resetDb, loginAgent, findCategory } = require('./helper');

describe('API Test: [Categories]', () => {
    let agent;
    let categoryId;

    before(async () => {
        await resetDb();
        agent = await loginAgent();
    });

    it('GET /categories - 로그인하지 않으면 401', async () => {
        await request(app).get('/categories').expect(401);
    });

    it('POST /categories - 생성', async () => {
        const res = await agent.post('/categories')
            .send({ name: '카페', type: 'expense' })
            .expect(201);

        assert.equal(res.body.name, '카페');
        assert.equal(res.body.type, 'expense');
        categoryId = res.body.id;
    });

    it('POST /categories - 구분이 잘못되면 400, 중복이면 409', async () => {
        await agent.post('/categories').send({ name: '저축', type: 'saving' }).expect(400);
        await agent.post('/categories').send({ name: '카페', type: 'expense' }).expect(409);
    });

    it('GET /categories?type=income - 구분으로 필터', async () => {
        const res = await agent.get('/categories?type=income').expect(200);

        assert.isAbove(res.body.length, 0);
        assert.isTrue(res.body.every(category => category.type === 'income'));
    });

    it('PATCH /categories/:id - 수정', async () => {
        const res = await agent.patch(`/categories/${categoryId}`)
            .send({ name: '카페/간식' })
            .expect(200);

        assert.equal(res.body.name, '카페/간식');
    });

    it('GET /categories/:id/transactions, /summary - 거래 목록과 기간 합계', async () => {
        await agent.post('/transactions')
            .send({ type: 'expense', amount: 4500, date: '2026-11-03', categoryId }).expect(201);
        await agent.post('/transactions')
            .send({ type: 'expense', amount: 5500, date: '2026-11-20', categoryId }).expect(201);
        await agent.post('/transactions')
            .send({ type: 'expense', amount: 9999, date: '2026-10-31', categoryId }).expect(201);

        const list = await agent.get(`/categories/${categoryId}/transactions`).expect(200);
        assert.equal(list.body.total, 3);

        const summary = await agent.get(`/categories/${categoryId}/summary?month=2026-11`).expect(200);
        assert.equal(summary.body.total, 10000);
        assert.equal(summary.body.count, 2);

        const ranged = await agent
            .get(`/categories/${categoryId}/summary?from=2026-10-01&to=2026-11-10`).expect(200);
        assert.equal(ranged.body.total, 14499);
        assert.equal(ranged.body.count, 2);
    });

    it('DELETE /categories/:id - 거래가 연결되어 있으면 409로 차단', async () => {
        await agent.delete(`/categories/${categoryId}`).expect(409);
    });

    it('DELETE /categories/:id - 거래가 없으면 삭제', async () => {
        const unused = await findCategory(agent, '쇼핑');
        await agent.delete(`/categories/${unused.id}`).expect(200);
        assert.notExists(await findCategory(agent, '쇼핑'));
    });

    it('다른 사용자의 카테고리는 404', async () => {
        const other = await loginAgent('other');
        await other.patch(`/categories/${categoryId}`).send({ name: '남의것' }).expect(404);
        await other.get(`/categories/${categoryId}/summary`).expect(404);
    });
});
