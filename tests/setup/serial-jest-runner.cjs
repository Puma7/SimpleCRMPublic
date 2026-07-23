const DefaultRunner = require('jest-runner').default;

class SerialJestRunner extends DefaultRunner {
  constructor(...args) {
    super(...args);
    this.isSerial = true;
  }
}

module.exports = SerialJestRunner;
