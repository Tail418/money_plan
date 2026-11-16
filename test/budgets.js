const assert = require('chai').assert;
const { resetDb, loginAgent, findCategory } = require('./helper');

describe('API Test: [Budgets]', () => {
    let agent;
    let food, transport, shopping, salary;
    let budgetId;

    before(async () => {
        await resetDb();
        agent = await loginAgent();
        food = await findCategory(agent, '식비');
        transport = await findCategory(agent, '교통');
        shopping = await findCategory(agent, '쇼핑');
        salary = await findCategory(agent, '월급');
    });

    it('POST /budgets - 예산 설정', async () => {
        const res = await agent.post('/budgets')
            .send({ month: '2026-10', categoryId: food.id, amount: 300000 })
            .expect(201);
        budgetId = res.body.id;

        await agent.post('/budgets').send({ month: '2026-10', categoryId: transport.id, amount: 100000 }).expect(201);
        await agent.post('/budgets').send({ month: '2026-10', categoryId: shopping.id, amount: 200000 }).expect(201);
    });

    it('POST /budgets - 중복은 409, 수입 카테고리와 잘못된 월은 400', async () => {
        await agent.post('/budgets').send({ month: '2026-10', categoryId: food.id, amount: 1 }).expect(409);
        await agent.post('/budgets').send({ month: '2026-10', categoryId: salary.id, amount: 1000 }).expect(400);
        await agent.post('/budgets').send({ month: '2026-13', categoryId: food.id, amount: 1000 }).expect(400);
    });

    it('GET /budgets?month= - 월별 목록 조회', async () => {
        const res = await agent.get('/budgets?month=2026-10').expect(200);
        assert.lengthOf(res.body, 3);
        assert.equal(res.body[0].Category.name, '식비');

        const empty = await agent.get('/budgets?month=2026-09').expect(200);
        assert.lengthOf(empty.body, 0);
    });

    it('PATCH /budgets/:id - 금액 수정', async () => {
        const res = await agent.patch(`/budgets/${budgetId}`).send({ amount: 400000 }).expect(200);
        assert.equal(res.body.amount, 400000);

        await agent.patch(`/budgets/${budgetId}`).send({ amount: 0 }).expect(400);
    });

    it('GET /budgets/status - 예산 대비 지출 소진율', async () => {
        // 식비 100,000 / 400,000 = 25%, 교통 85,000 / 100,000 = 85%, 쇼핑 250,000 / 200,000 = 125%
        const send = (categoryId, amount, date) =>
            agent.post('/transactions').send({ type: 'expense', amount, date, categoryId }).expect(201);
        await send(food.id, 60000, '2026-10-03');
        await send(food.id, 40000, '2026-10-15');
        await send(transport.id, 85000, '2026-10-10');
        await send(shopping.id, 250000, '2026-10-20');
        await send(food.id, 999999, '2026-11-01');   // 다른 달 지출은 포함되지 않아야 한다

        const res = await agent.get('/budgets/status?month=2026-10').expect(200);

        const foodStatus = res.body.items.find(item => item.categoryId === food.id);
        assert.equal(foodStatus.spent, 100000);
        assert.equal(foodStatus.remaining, 300000);
        assert.equal(foodStatus.rate, 25);

        assert.equal(res.body.total.amount, 700000);
        assert.equal(res.body.total.spent, 435000);
    });

    it('GET /budgets/alerts - 80% 이상 소진되었거나 초과한 예산만 나온다', async () => {
        const res = await agent.get('/budgets/alerts?month=2026-10').expect(200);

        assert.lengthOf(res.body, 2);
        assert.equal(res.body[0].categoryName, '쇼핑');
        assert.equal(res.body[0].level, 'exceeded');
        assert.equal(res.body[1].categoryName, '교통');
        assert.equal(res.body[1].level, 'warning');
    });

    it('POST /budgets/copy-previous - 전월 예산을 복사하고 이미 있는 카테고리는 건너뛴다', async () => {
        // 11월에 식비 예산을 미리 만들어 두면 복사 대상에서 빠진다
        await agent.post('/budgets').send({ month: '2026-11', categoryId: food.id, amount: 350000 }).expect(201);

        const res = await agent.post('/budgets/copy-previous').send({ month: '2026-11' }).expect(201);
        assert.equal(res.body.from, '2026-10');
        assert.equal(res.body.copied, 2);
        assert.equal(res.body.skipped, 1);

        const november = (await agent.get('/budgets?month=2026-11').expect(200)).body;
        assert.lengthOf(november, 3);
        assert.equal(november.find(budget => budget.categoryId === food.id).amount, 350000);
        assert.equal(november.find(budget => budget.categoryId === shopping.id).amount, 200000);
    });

    it('POST /budgets/copy-previous - 전월 예산이 없으면 404', async () => {
        await agent.post('/budgets/copy-previous').send({ month: '2026-05' }).expect(404);
    });

    it('DELETE /budgets/:id - 삭제', async () => {
        await agent.delete(`/budgets/${budgetId}`).expect(200);
        await agent.delete(`/budgets/${budgetId}`).expect(404);
    });
});
