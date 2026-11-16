const assert = require('chai').assert;
const { request, app, resetDb, loginAgent, findCategory } = require('./helper');
const { currentMonth, shiftMonth } = require('../routes/helpers');

describe('API Test: [Stats]', () => {
    let agent;
    let bank, card;

    // 2026-10 한 달 데이터: 수입 3,000,000 / 지출 100,000 (식비 60,000 + 교통 40,000)
    // 그리고 통계에 잡히면 안 되는 이체 500,000
    before(async () => {
        await resetDb();
        agent = await loginAgent();

        const food = await findCategory(agent, '식비');
        const transport = await findCategory(agent, '교통');
        const salary = await findCategory(agent, '월급');
        bank = (await agent.post('/accounts').send({ name: '통장', type: 'bank' }).expect(201)).body;
        card = (await agent.post('/accounts').send({ name: '카드', type: 'card' }).expect(201)).body;

        await agent.post('/transactions/bulk').send({
            transactions: [
                { type: 'income', amount: 3000000, date: '2026-10-01', categoryId: salary.id, accountId: bank.id },
                { type: 'expense', amount: 35000, date: '2026-10-05', categoryId: food.id, accountId: card.id, memo: '회식' },
                { type: 'expense', amount: 25000, date: '2026-10-05', categoryId: food.id, accountId: bank.id, memo: '장보기' },
                { type: 'expense', amount: 40000, date: '2026-10-12', categoryId: transport.id, accountId: card.id, memo: '기차표' },
                { type: 'expense', amount: 7000, date: '2026-09-30', categoryId: food.id, accountId: card.id }
            ]
        }).expect(201);

        await agent.post('/accounts/transfer')
            .send({ fromAccountId: bank.id, toAccountId: card.id, amount: 500000, date: '2026-10-07' })
            .expect(201);
    });

    it('GET /stats/monthly - 로그인하지 않으면 401', async () => {
        await request(app).get('/stats/monthly').expect(401);
    });

    it('GET /stats/monthly - 월 총수입, 총지출, 잔액 (이체는 제외)', async () => {
        const res = await agent.get('/stats/monthly?month=2026-10').expect(200);

        assert.deepEqual(res.body, {
            month: '2026-10', income: 3000000, expense: 100000, balance: 2900000
        });

        await agent.get('/stats/monthly?month=2026-1').expect(400);
    });

    it('GET /stats/daily - 일별 합계', async () => {
        const res = await agent.get('/stats/daily?month=2026-10').expect(200);

        assert.deepEqual(res.body.days, [
            { date: '2026-10-01', income: 3000000, expense: 0 },
            { date: '2026-10-05', income: 0, expense: 60000 },
            { date: '2026-10-12', income: 0, expense: 40000 }
        ]);
    });

    it('GET /stats/by-category - 카테고리별 비중', async () => {
        const res = await agent.get('/stats/by-category?month=2026-10').expect(200);

        assert.equal(res.body.total, 100000);
        assert.lengthOf(res.body.items, 2);
        assert.include(res.body.items[0], { name: '식비', total: 60000, count: 2, ratio: 60 });
        assert.include(res.body.items[1], { name: '교통', total: 40000, count: 1, ratio: 40 });
    });

    it('GET /stats/trend - 최근 N개월 추이', async () => {
        const res = await agent.get('/stats/trend?months=3').expect(200);

        assert.lengthOf(res.body, 3);
        assert.equal(res.body[2].month, currentMonth());
        assert.equal(res.body[0].month, shiftMonth(currentMonth(), -2));
        res.body.forEach(item => assert.equal(item.balance, item.income - item.expense));

        await agent.get('/stats/trend?months=0').expect(400);
    });

    it('GET /stats/top-expenses - 지출 상위 N건', async () => {
        const res = await agent.get('/stats/top-expenses?month=2026-10&limit=2').expect(200);

        assert.lengthOf(res.body, 2);
        assert.equal(res.body[0].amount, 40000);
        assert.equal(res.body[0].memo, '기차표');
        assert.equal(res.body[1].amount, 35000);
    });

    it('GET /stats/by-account - 결제수단별 사용액', async () => {
        const res = await agent.get('/stats/by-account?month=2026-10').expect(200);

        assert.lengthOf(res.body.items, 2);
        assert.include(res.body.items[0], { accountId: card.id, name: '카드', total: 75000, count: 2 });
        assert.include(res.body.items[1], { accountId: bank.id, name: '통장', total: 25000, count: 1 });
    });
});
