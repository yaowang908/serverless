'use strict';

const path = require('path');
const BbPromise = require('bluebird');
const fse = BbPromise.promisifyAll(require('fs-extra'));
const { memoize, merge } = require('lodash');
const { load: loadYaml, dump: saveYaml } = require('js-yaml');
const provisionTmpDir = require('@serverless/test/provision-tmp-dir');

const isFixtureConfigured = memoize(fixturePath => {
  let stats;
  try {
    stats = fse.statSync(fixturePath);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  return Boolean(stats.isDirectory());
});

const retrievedFixturesPaths = new Set();

module.exports = {
  map: new Proxy(
    {},
    {
      get: (obj, fixtureName) => {
        const fixturePath = path.join(__dirname, fixtureName);
        if (!isFixtureConfigured(fixturePath)) {
          throw new Error(`No fixture configured at ${fixtureName}`);
        }
        retrievedFixturesPaths.add(fixturePath);
        return fixturePath;
      },
    }
  ),
  extend: (fixtureName, extConfig) => {
    const baseFixturePath = path.join(__dirname, fixtureName);
    if (!isFixtureConfigured(baseFixturePath)) {
      throw new Error(`No fixture configured at ${fixtureName}`);
    }
    return provisionTmpDir().then(fixturePath => {
      return Promise.all([
        fse.readFileAsync(path.join(baseFixturePath, 'serverless.yml')),
        fse.copyAsync(baseFixturePath, fixturePath),
      ])
        .then(([yamlConfig]) =>
          fse.writeFileAsync(
            path.join(fixturePath, 'serverless.yml'),
            saveYaml(merge(loadYaml(yamlConfig), extConfig))
          )
        )
        .then(() => fixturePath);
    });
  },
  cleanup: (options = {}) =>
    Promise.all(
      Array.from(retrievedFixturesPaths, fixturePath => {
        const pathsToRemove = [path.join(fixturePath, '.serverless')];
        if (options.extraPaths) {
          pathsToRemove.push(...options.extraPaths.map(dirname => path.join(fixturePath, dirname)));
        }
        return Promise.all(
          pathsToRemove.map(pathToRemove => fse.removeAsync(pathToRemove))
        ).then(() => retrievedFixturesPaths.delete(fixturePath));
      })
    ),
};
