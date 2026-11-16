// 모든 테스트 파일이 가장 먼저 불러오는 공통 준비 코드.
// 테스트는 config.json의 "test" 설정(money_plan_test DB)을 사용하므로 개발용 데이터는 건드리지 않는다.
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../app');
const { sequelize } = require('../models');

const PASSWORD = 'password1234';

// 테이블을 전부 새로 만든다. 각 테스트 파일의 before에서 호출.
const resetDb = () => sequelize.sync({ force: true });

// 회원가입 + 로그인까지 마친 agent를 돌려준다. agent는 세션 쿠키를 유지한다.
const loginAgent = async (id = 'tester') => {
    const agent = request.agent(app);
    await agent.post('/auth/signup').send({ id, password: PASSWORD, name: '테스터' }).expect(201);
    await agent.post('/auth/login').send({ id, password: PASSWORD }).expect(200);
    return agent;
};

// 기본 카테고리 중 이름으로 하나 찾기
const findCategory = async (agent, name) => {
    const res = await agent.get('/categories').expect(200);
    return res.body.find(category => category.name === name);
};

module.exports = { request, app, PASSWORD, resetDb, loginAgent, findCategory };
