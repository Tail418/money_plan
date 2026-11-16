const Sequelize = require('sequelize');

module.exports = class Transaction extends Sequelize.Model {
    static init(sequelize) {
        return super.init({
            type: {
                type: Sequelize.ENUM('income', 'expense'),
                allowNull: false
            },
            amount: {
                type: Sequelize.INTEGER,
                allowNull: false
            },
            date: {
                type: Sequelize.DATEONLY,
                allowNull: false
            },
            memo: {
                type: Sequelize.STRING(200),
                allowNull: true
            },
            // 계좌 간 이체로 생긴 거래는 출금/입금 두 건이 같은 transferId를 가진다.
            // 일반 거래는 null 이고, 이체 거래는 통계와 예산 계산에서 제외한다.
            transferId: {
                type: Sequelize.STRING(36),
                allowNull: true
            }
        }, {
            sequelize,
            timestamps: true,
            modelName: 'Transaction',
            tableName: 'transactions',
            charset: 'utf8mb4',
            collate: 'utf8mb4_general_ci',
        });
    }

    static associate(db) {
        db.Transaction.belongsTo(db.User, { foreignKey: { name: 'userId', allowNull: false }, targetKey: 'id', onDelete: 'cascade' });
        db.Transaction.belongsTo(db.Category, { foreignKey: 'categoryId', targetKey: 'id', onDelete: 'restrict' });
        db.Transaction.belongsTo(db.Account, { foreignKey: 'accountId', targetKey: 'id', onDelete: 'restrict' });
    }
};
