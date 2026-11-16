const assert = require('chai').assert;
const { request, app, resetDb, loginAgent, findCategory } = require('./helper');

describe('API Test: [Transactions]', () => {
    let agent;
    let food, transport, salary, account;
    let transactionId;

    before(async () => {
        await resetDb();
        agent = await loginAgent();
        food = await findCategory(agent, '식비');
        transport = await findCategory(agent, '교통');
        salary = await findCategory(agent, '월급');
        account = (await agent.post('/accounts').send({ name: '통장', initialBalance: 0 }).expect(201)).body;
    });

    it('POST /transactions - 로그인하지 않으면 401', async () => {
        await request(app).post('/transactions').send({}).expect(401);
    });

    it('POST /transactions - 거래 등록', async () => {
        const res = await agent.post('/transactions')
            .send({
                type: 'expense', amount: 12000, date: '2026-11-05',
                categoryId: food.id, accountId: account.id, memo: '점심 김치찌개'
            })
            .expect(201);

        assert.equal(res.body.amount, 12000);
        assert.equal(res.body.date, '2026-11-05');
        transactionId = res.body.id;
    });

    it('POST /transactions - 잘못된 값은 400', async () => {
        const valid = { type: 'expense', amount: 1000, date: '2026-11-05', categoryId: food.id };

        await agent.post('/transactions').send({ ...valid, amount: 0 }).expect(400);
        await agent.post('/transactions').send({ ...valid, amount: '천원' }).expect(400);
        await agent.post('/transactions').send({ ...valid, date: '2026-02-30' }).expect(400);
        await agent.post('/transactions').send({ ...valid, type: 'saving' }).expect(400);
        await agent.post('/transactions').send({ ...valid, categoryId: 99999 }).expect(400);
        // 지출 거래에 수입 카테고리는 쓸 수 없다
        await agent.post('/transactions').send({ ...valid, categoryId: salary.id }).expect(400);
    });

    it('POST /transactions/bulk - 여러 건 일괄 등록', async () => {
        const res = await agent.post('/transactions/bulk')
            .send({
                transactions: [
                    { type: 'income', amount: 3000000, date: '2026-11-01', categoryId: salary.id, accountId: account.id, memo: '11월 월급' },
                    { type: 'expense', amount: 1500, date: '2026-11-02', categoryId: transport.id, memo: '버스' },
                    { type: 'expense', amount: 8000, date: '2026-10-28', categoryId: food.id, memo: '저녁 김밥' }
                ]
            })
            .expect(201);

        assert.equal(res.body.count, 3);
    });

    it('POST /transactions/bulk - 한 건이라도 잘못되면 전부 등록되지 않는다', async () => {
        const before = (await agent.get('/transactions').expect(200)).body.total;

        const res = await agent.post('/transactions/bulk')
            .send({
                transactions: [
                    { type: 'expense', amount: 1000, date: '2026-11-03', categoryId: food.id },
                    { type: 'expense', amount: -5, date: '2026-11-03', categoryId: food.id }
                ]
            })
            .expect(400);
        assert.include(res.body.message, '2번째 항목');

        const after = (await agent.get('/transactions').expect(200)).body.total;
        assert.equal(after, before);
    });

    it('GET /transactions - 목록은 최신 날짜순이고 페이지네이션 된다', async () => {
        const res = await agent.get('/transactions?page=1&limit=2').expect(200);

        assert.equal(res.body.total, 4);
        assert.equal(res.body.totalPages, 2);
        assert.lengthOf(res.body.items, 2);
        assert.equal(res.body.items[0].date, '2026-11-05');
        assert.equal(res.body.items[0].Category.name, '식비');
    });

    it('GET /transactions - 기간, 카테고리, 구분, 메모 검색 필터', async () => {
        const byPeriod = await agent.get('/transactions?from=2026-11-01&to=2026-11-30').expect(200);
        assert.equal(byPeriod.body.total, 3);

        const byCategory = await agent.get(`/transactions?categoryId=${food.id}`).expect(200);
        assert.equal(byCategory.body.total, 2);

        const byType = await agent.get('/transactions?type=income').expect(200);
        assert.equal(byType.body.total, 1);

        const byMemo = await agent.get(`/transactions?q=${encodeURIComponent('김')}`).expect(200);
        assert.equal(byMemo.body.total, 2);   // 김치찌개, 김밥

        await agent.get('/transactions?from=2026-11-31').expect(400);
    });

    it('GET /transactions/recent - 최근 거래 N건', async () => {
        const res = await agent.get('/transactions/recent?limit=3').expect(200);

        assert.lengthOf(res.body, 3);
        assert.equal(res.body[0].date, '2026-11-05');
    });

    it('GET /transactions/export - CSV 내보내기', async () => {
        const res = await agent.get('/transactions/export?month=2026-11').expect(200);

        assert.match(res.headers['content-type'], /text\/csv/);
        assert.match(res.headers['content-disposition'], /attachment/);

        const lines = res.text.replace('﻿', '').trim().split('\n');
        assert.equal(lines[0], '날짜,구분,카테고리,결제수단,금액,메모');
        assert.lengthOf(lines, 4);   // 헤더 + 11월 거래 3건
        assert.equal(lines[1], '2026-11-05,지출,식비,통장,12000,점심 김치찌개');
    });

    it('GET /transactions/:id - 상세 조회', async () => {
        const res = await agent.get(`/transactions/${transactionId}`).expect(200);

        assert.equal(res.body.memo, '점심 김치찌개');
        assert.equal(res.body.Account.name, '통장');

        await agent.get('/transactions/99999').expect(404);
    });

    it('PATCH /transactions/:id - 보낸 항목만 수정된다', async () => {
        const res = await agent.patch(`/transactions/${transactionId}`)
            .send({ amount: 13000 })
            .expect(200);

        assert.equal(res.body.amount, 13000);
        assert.equal(res.body.memo, '점심 김치찌개');

        await agent.patch(`/transactions/${transactionId}`).send({ amount: -1 }).expect(400);
    });

    it('다른 사용자의 거래는 볼 수도 지울 수도 없다', async () => {
        const other = await loginAgent('other');
        await other.get(`/transactions/${transactionId}`).expect(404);
        await other.delete(`/transactions/${transactionId}`).expect(404);
    });

    it('DELETE /transactions/:id - 삭제', async () => {
        await agent.delete(`/transactions/${transactionId}`).expect(200);
        await agent.get(`/transactions/${transactionId}`).expect(404);
    });
});
