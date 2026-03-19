module.exports = {
    testEnvironment: 'jsdom',
    setupFilesAfterEnv: ['./tests/js/setup.js'],
    transform: {
        '^.+\\.jsx?$': 'babel-jest',
    },
    transformIgnorePatterns: ['/node_modules/(?!zustand)'],
    moduleNameMapper: {
        '\\.(css|less|scss)$': '<rootDir>/tests/js/__mocks__/styleMock.js',
        '@wordpress/i18n': '<rootDir>/tests/js/__mocks__/wpI18n.js',
        '^fabric$': '<rootDir>/tests/js/__mocks__/fabric.js',
    },
    testMatch: ['<rootDir>/tests/js/**/*.test.js'],
};
