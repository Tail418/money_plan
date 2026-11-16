const Sequelize = require('sequelize');

// 결제수단 (현금, 통장, 카드 등)
module.exports = class Account extends Sequelize.Model {
    static init(sequelize) {
        return super.init({
            name: {
                type: Sequelize.STRING(30),
                allowNull: false
            },
            type: {
                type: Sequelize.ENUM('cash', 'bank', 'card', 'etc'),
                allowNull: false,
                defaultValue: 'bank'
            },
            // 등록 시점의 시작 잔액. 현재 잔액 = 시작 잔액 + 수입 - 지출
            initialBalance: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0
            }
        }, {
            sequelize,
            timestamps: false,
            modelName: 'Account',
            tableName: 'accounts',
            charset: 'utf8mb4',
            collate: 'utf8mb4_general_ci',
        });
    }

    static associate(db) {
        db.Account.belongsTo(db.User, { foreignKey: { name: 'userId', allowNull: false }, targetKey: 'id', onDelete: 'cascade' });
        db.Account.hasMany(db.Transaction, { foreignKey: 'accountId', sourceKey: 'id', onDelete: 'restrict' });
    }
};
