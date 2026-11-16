const Sequelize = require('sequelize');

module.exports = class User extends Sequelize.Model {
    static init(sequelize) {
        return super.init({
            id: {
                type: Sequelize.STRING(100),
                allowNull: false,
                primaryKey: true
            },
            password: {
                type: Sequelize.STRING(100),
                allowNull: false
            },
            name: {
                type: Sequelize.STRING(20),
                allowNull: false
            },
            description: {
                type: Sequelize.TEXT,
                allowNull: true
            }
        }, {
            sequelize,
            timestamps: true,
            modelName: 'User',
            tableName: 'users',
            charset: 'utf8mb4',
            collate: 'utf8mb4_general_ci',
        });
    }

    static associate(db) {
        const options = { foreignKey: { name: 'userId', allowNull: false }, sourceKey: 'id', onDelete: 'cascade' };
        db.User.hasMany(db.Category, options);
        db.User.hasMany(db.Account, options);
        db.User.hasMany(db.Transaction, options);
        db.User.hasMany(db.Budget, options);
    }
};
