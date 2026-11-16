const path = require('path');

const dotenv = require('dotenv');

const express = require('express');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const session = require('express-session');

const { sequelize } = require('./models');

const passport = require('passport');
const passportConfig = require('./passport');

const authRouter = require('./routes/auth');
const transactionRouter = require('./routes/transactions');
const categoryRouter = require('./routes/categories');
const accountRouter = require('./routes/accounts');
const budgetRouter = require('./routes/budgets');
const statRouter = require('./routes/stats');

dotenv.config();
passportConfig();

const app = express();
app.set('port', process.env.PORT || 3000);

const isTest = process.env.NODE_ENV === 'test';
const secret = process.env.SECRET || 'money-plan-secret';

if (!isTest) app.use(morgan('dev'));

app.use(
    express.static(path.join(__dirname, 'public')),
    express.json(),
    express.urlencoded({ extended: false }),
    cookieParser(secret),
    session({
        resave: false,
        saveUninitialized: false,
        secret,
        cookie: {
            httpOnly: true,
            secure: false
        },
        name: 'session-cookie'
    })
);

app.use(passport.initialize());
app.use(passport.session());

app.use('/auth', authRouter);
app.use('/transactions', transactionRouter);
app.use('/categories', categoryRouter);
app.use('/accounts', accountRouter);
app.use('/budgets', budgetRouter);
app.use('/stats', statRouter);

// 등록되지 않은 경로
app.use((req, res) =>
    res.status(404).json({ message: `${req.method} ${req.originalUrl} 경로를 찾을 수 없습니다.` }));

// 에러 처리: fail()로 만든 에러는 status를 가지고 있고, 그 외는 500
app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status === 500 && !isTest) console.error(err);
    res.status(status).json({ message: status === 500 ? '서버 오류가 발생했습니다.' : err.message });
});

// 테스트에서 require 할 때는 서버를 띄우지 않고, 직접 실행할 때만 DB 동기화 후 대기
if (require.main === module) {
    sequelize.sync({ force: false })
        .then(() => {
            console.log('데이터베이스 연결 성공');
            app.listen(app.get('port'), () => {
                console.log(app.get('port'), '번 포트에서 대기 중');
            });
        })
        .catch(err => console.error(err));
}

// 테스트를 위해서 반드시 추가
module.exports = app;
