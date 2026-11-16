const assert = require('chai').assert;
const { resetDb, loginAgent, findCategory } = require('./helper');

describe('API Test: [Accounts]', () => {
    let agent;
    let bank, card, food, salary;

    before(async () => {
        await resetDb();
        agent = await loginAgent();
        food = await findCategory(agent, '식비');
        salary = await findCategory(agent, '월급');
    });

    it('POST /accounts - 결제수단 등록', async () => {
        const res = await agent.post('/accounts')
            .send({ name: '국민은행', type: 'bank', initialBalance: 100000 })
            .expect(201);
        bank = res.body;
        assert.equal(bank.initialBalance, 100000);

        card = (await agent.post('/accounts').send({ name: '체크카드', type: 'card' }).expect(201)).body;
        assert.equal(card.initialBalance, 0);
    });

    it('POST /accounts - 종류가 잘못되면 400, 이름이 중복이면 409', async () => {
        await agent.post('/accounts').send({ name: '비트코인', type: 'coin' }).expect(400);
        await agent.post('/accounts').send({ name: '국민은행' }).expect(409);
    });

    it('GET /accounts - 목록에 현재 잔액이 포함된다', async () => {
        await agent.post('/transactions')
            .send({ type: 'income', amount: 50000, date: '2026-01-10', categoryId: salary.id, accountId: bank.id })
            .expect(201);
        await agent.post('/transactions')
            .send({ type: 'expense', amount: 20000, date: '2026-01-20', categoryId: food.id, accountId: bank.id })
            .expect(201);

        const res = await agent.get('/accounts').expect(200);
        const found = res.body.find(account => account.id === bank.id);
        assert.equal(found.balance, 130000);   // 100000 + 50000 - 20000
    });

    it('GET /accounts/:id/balance?date= - 특정 시점 잔액 계산', async () => {
        const res = await agent.get(`/accounts/${bank.id}/balance?date=2026-01-15`).expect(200);
        assert.equal(res.body.balance, 150000);   // 1/20 지출은 아직 반영되지 않음

        await agent.get(`/accounts/${bank.id}/balance?date=2026-13-99`).expect(400);
    });

    it('POST /accounts/transfer - 출금과 입금이 함께 기록되고 두 잔액이 바뀐다', async () => {
        const res = await agent.post('/accounts/transfer')
            .send({ fromAccountId: bank.id, toAccountId: card.id, amount: 30000, date: '2026-01-25' })
            .expect(201);

        assert.exists(res.body.transferId);
        assert.equal(res.body.withdrawal.accountId, bank.id);
        assert.equal(res.body.withdrawal.type, 'expense');
        assert.equal(res.body.deposit.accountId, card.id);
        assert.equal(res.body.deposit.type, 'income');

        const accounts = (await agent.get('/accounts').expect(200)).body;
        assert.equal(accounts.find(account => account.id === bank.id).balance, 100000);
        assert.equal(accounts.find(account => account.id === card.id).balance, 30000);
    });

    it('POST /accounts/transfer - 같은 계좌, 없는 계좌, 잘못된 금액은 거부되고 아무것도 기록되지 않는다', async () => {
        await agent.post('/accounts/transfer')
            .send({ fromAccountId: bank.id, toAccountId: bank.id, amount: 1000 }).expect(400);
        await agent.post('/accounts/transfer')
            .send({ fromAccountId: bank.id, toAccountId: 99999, amount: 1000 }).expect(404);
        await agent.post('/accounts/transfer')
            .send({ fromAccountId: bank.id, toAccountId: card.id, amount: -1000 }).expect(400);

        const res = await agent.get(`/accounts/${bank.id}/balance`).expect(200);
        assert.equal(res.body.balance, 100000);
    });

    it('GET /accounts/:id/transactions - 해당 결제수단 거래 목록', async () => {
        const res = await agent.get(`/accounts/${bank.id}/transactions`).expect(200);

        assert.equal(res.body.total, 3);   // 수입 1 + 지출 1 + 이체 출금 1
        assert.isTrue(res.body.items.every(item => item.accountId === bank.id));
    });

    it('PATCH /accounts/:id - 수정', async () => {
        const res = await agent.patch(`/accounts/${card.id}`).send({ name: '신한 체크카드' }).expect(200);
        assert.equal(res.body.name, '신한 체크카드');
    });

    it('DELETE /accounts/:id - 거래가 연결되어 있으면 409, 없으면 삭제', async () => {
        await agent.delete(`/accounts/${bank.id}`).expect(409);

        const cash = (await agent.post('/accounts').send({ name: '현금', type: 'cash' }).expect(201)).body;
        await agent.delete(`/accounts/${cash.id}`).expect(200);
        await agent.get(`/accounts/${cash.id}/balance`).expect(404);
    });
});
