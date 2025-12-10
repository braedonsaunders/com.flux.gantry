const SuiteCloudJestUnitTestRunner = require('@oracle/suitecloud-unit-testing/services/SuiteCloudJestUnitTestRunner');

module.exports = {
    defaultProjectFolder: 'src',
    commands: {
        'project:deploy': {
            // Validate the project before deploying
            validate: true,
        },
        'project:validate': {},
        'file:upload': {},
    },
    // Optional: Configure unit test runner
    // suiteCloudJestConfiguration: {
    //     testRunner: SuiteCloudJestUnitTestRunner,
    //     collectCoverage: true
    // }
};
