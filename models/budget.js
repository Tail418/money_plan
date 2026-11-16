const Sequelize = require('sequelize');

module.exports = class Budget extends Sequelize.Model {
    static init(sequelize) {
        return super.init({
            // 'YYYY-MM' 형식
            month: {
                type: Sequelize.STRING(7),
                allowNull: false
            },
            amount: {
                type: Sequelize.INTEGER,
                allowNull: false
            }
        }, {
            sequelize,
            timestamps: false,
            modelName: 'Budget',
            tableName: 'budgets',
            charset: 'utf8mb4',
            collate: 'utf8mb4_general_ci',
            // 한 달에 카테고리당 예산은 하나만
            indexes: [{ unique: true, fields: ['userId', 'month', 'categoryId'] }]
        });
    }

    static associate(db) {
        db.Budget.belongsTo(db.User, { foreignKey: { name: 'userId', allowNull: false }, targetKey: 'id', onDelete: 'cascade' });
        db.Budget.belongsTo(db.Category, { foreignKey: { name: 'categoryId', allowNull: false }, targetKey: 'id', onDelete: 'cascade' });
    }
};
