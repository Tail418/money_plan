const Sequelize = require('sequelize');
const User = require('./user');
const Category = require('./category');
const Account = require('./account');
const Transaction = require('./transaction');
const Budget = require('./budget');

const env = process.env.NODE_ENV || 'development';
const config = require('../config/config')[env];

const sequelize = new Sequelize(
    config.database, config.username, config.password, config
);

const db = {
    sequelize,
    User,
    Category,
    Account,
    Transaction,
    Budget
};

User.init(sequelize);
Category.init(sequelize);
Account.init(sequelize);
Transaction.init(sequelize);
Budget.init(sequelize);

User.associate(db);
Category.associate(db);
Account.associate(db);
Transaction.associate(db);
Budget.associate(db);

module.exports = db;
