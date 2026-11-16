const Sequelize = require('sequelize');

module.exports = class Category extends Sequelize.Model {
    static init(sequelize) {
        return super.init({
            name: {
                type: Sequelize.STRING(30),
                allowNull: false
            },
            // 수입(income) / 지출(expense) 구분
            type: {
                type: Sequelize.ENUM('income', 'expense'),
                allowNull: false
            }
        }, {
            sequelize,
            timestamps: false,
            modelName: 'Category',
            tableName: 'categories',
            charset: 'utf8mb4',
            collate: 'utf8mb4_general_ci',
        });
    }

    static associate(db) {
        db.Category.belongsTo(db.User, { foreignKey: { name: 'userId', allowNull: false }, targetKey: 'id', onDelete: 'cascade' });
        db.Category.hasMany(db.Transaction, { foreignKey: 'categoryId', sourceKey: 'id', onDelete: 'restrict' });
        db.Category.hasMany(db.Budget, { foreignKey: { name: 'categoryId', allowNull: false }, sourceKey: 'id', onDelete: 'cascade' });
    }
};
