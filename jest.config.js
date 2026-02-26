/** @type {import('jest').Config} */
module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	roots: ['<rootDir>/src'],
	testMatch: ['**/__tests__/**/*.test.ts'],
	transform: {
		'^.+\\.ts$': ['ts-jest', {
			tsconfig: 'tsconfig.test.json'
		}],
	},
	collectCoverageFrom: [
		'src/**/*.ts',
		'!src/**/*.test.ts',
		'!src/**/__tests__/**',
	],
	moduleFileExtensions: ['ts', 'js'],
	moduleDirectories: ['node_modules', '<rootDir>/node_modules'],
	modulePaths: ['<rootDir>'],
	verbose: true,
};
