'use strict';

const { expect } = require('chai');
const runServerless = require('../../../../../../../tests/utils/run-serverless');
const fixtures = require('../../../../../../../tests/fixtures');

describe('HttpApiEvents', () => {
  after(fixtures.cleanup);

  it('Should not configure HTTP when events are not configured', () =>
    runServerless({
      config: { service: 'irrelevant', provider: 'aws' },
      cliArgs: ['package'],
    }).then(serverless => {
      const cfResources = serverless.service.provider.compiledCloudFormationTemplate.Resources;
      const naming = serverless.getProvider('aws').naming;

      expect(cfResources[naming.getHttpApiLogicalId()]).to.equal();
      expect(cfResources[naming.getHttpApiStageLogicalId()]).to.equal();
    }));

  describe('Specific endpoints', () => {
    let cfResources;
    let cfOutputs;
    let naming;

    before(() =>
      runServerless({
        cwd: fixtures.map.httpApi,
        cliArgs: ['package'],
      }).then(serverless => {
        ({
          Resources: cfResources,
          Outputs: cfOutputs,
        } = serverless.service.provider.compiledCloudFormationTemplate);
        naming = serverless.getProvider('aws').naming;
      })
    );

    it('Should configure API resource', () => {
      const resource = cfResources[naming.getHttpApiLogicalId()];
      expect(resource.Type).to.equal('AWS::ApiGatewayV2::Api');
      expect(resource.Properties).to.have.property('Name');
      expect(resource.Properties.ProtocolType).to.equal('HTTP');
    });

    it('Should not configure default route', () => {
      const resource = cfResources[naming.getHttpApiLogicalId()];
      expect(resource.Properties).to.not.have.property('RouteKey');
      expect(resource.Properties).to.not.have.property('Target');
    });
    it('Should not configure cors when not asked to', () => {
      const resource = cfResources[naming.getHttpApiLogicalId()];
      expect(resource.Properties).to.not.have.property('CorsConfiguration');
    });
    it('Should configure stage resource', () => {
      const resource = cfResources[naming.getHttpApiStageLogicalId()];
      expect(resource.Type).to.equal('AWS::ApiGatewayV2::Stage');
      expect(resource.Properties.StageName).to.equal('$default');
      expect(resource.Properties.AutoDeploy).to.equal(true);
    });
    it('Should configure output', () => {
      const output = cfOutputs.HttpApiUrl;
      expect(output).to.have.property('Value');
    });
    it('Should configure endpoint', () => {
      const routeKey = 'POST /some-post';
      const resource = cfResources[naming.getHttpApiRouteLogicalId(routeKey)];
      expect(resource.Type).to.equal('AWS::ApiGatewayV2::Route');
      expect(resource.Properties.RouteKey).to.equal(routeKey);
    });
    it('Should configure endpoint integration', () => {
      const resource = cfResources[naming.getHttpApiIntegrationLogicalId('foo')];
      expect(resource.Type).to.equal('AWS::ApiGatewayV2::Integration');
      expect(resource.Properties.IntegrationType).to.equal('AWS_PROXY');
    });
    it('Should configure lambda permissions', () => {
      const resource = cfResources[naming.getLambdaHttpApiPermissionLogicalId('foo')];
      expect(resource.Type).to.equal('AWS::Lambda::Permission');
      expect(resource.Properties.Action).to.equal('lambda:InvokeFunction');
    });
  });

  describe('Catch-all endpoints', () => {
    let cfResources;
    let cfOutputs;
    let naming;

    before(() =>
      runServerless({
        cwd: fixtures.map.httpApiCatchAll,
        cliArgs: ['package'],
      }).then(serverless => {
        ({
          Resources: cfResources,
          Outputs: cfOutputs,
        } = serverless.service.provider.compiledCloudFormationTemplate);
        naming = serverless.getProvider('aws').naming;
      })
    );

    it('Should configure API resource', () => {
      const resource = cfResources[naming.getHttpApiLogicalId()];
      expect(resource.Type).to.equal('AWS::ApiGatewayV2::Api');
      expect(resource.Properties).to.have.property('Name');
      expect(resource.Properties.ProtocolType).to.equal('HTTP');
    });

    it('Should configure default route', () => {
      const resource = cfResources[naming.getHttpApiLogicalId()];
      expect(resource.Properties.RouteKey).to.equal('$default');
      expect(resource.Properties).to.have.property('Target');
    });
    it('Should not configure stage resource', () => {
      expect(cfResources).to.not.have.property(naming.getHttpApiStageLogicalId());
    });
    it('Should configure output', () => {
      const output = cfOutputs.HttpApiUrl;
      expect(output).to.have.property('Value');
    });
    it('Should configure catch all endpoint', () => {
      const routeKey = 'ANY /foo';
      const resource = cfResources[naming.getHttpApiRouteLogicalId(routeKey)];
      expect(resource.Type).to.equal('AWS::ApiGatewayV2::Route');
      expect(resource.Properties.RouteKey).to.equal(routeKey);
    });
    it('Should configure endpoint integration', () => {
      const resource = cfResources[naming.getHttpApiIntegrationLogicalId('other')];
      expect(resource.Type).to.equal('AWS::ApiGatewayV2::Integration');
      expect(resource.Properties.IntegrationType).to.equal('AWS_PROXY');
    });
    it('Should configure lambda permissions for global catch all target', () => {
      const resource = cfResources[naming.getLambdaHttpApiPermissionLogicalId('foo')];
      expect(resource.Type).to.equal('AWS::Lambda::Permission');
      expect(resource.Properties.Action).to.equal('lambda:InvokeFunction');
    });
    it('Should configure lambda permissions for path catch all target', () => {
      const resource = cfResources[naming.getLambdaHttpApiPermissionLogicalId('other')];
      expect(resource.Type).to.equal('AWS::Lambda::Permission');
      expect(resource.Properties.Action).to.equal('lambda:InvokeFunction');
    });
  });

  describe('Cors', () => {
    let cfCors;

    describe('`true` configuration', () => {
      before(() =>
        fixtures.extend('httpApi', { provider: { httpApi: { cors: true } } }).then(fixturePath =>
          runServerless({
            cwd: fixturePath,
            cliArgs: ['package'],
          }).then(serverless => {
            cfCors =
              serverless.service.provider.compiledCloudFormationTemplate.Resources[
                serverless.getProvider('aws').naming.getHttpApiLogicalId()
              ].Properties.CorsConfiguration;
          })
        )
      );
      it('Should not set AllowCredentials', () => expect(cfCors.AllowCredentials).to.equal());
      it('Should include default set of headers at AllowHeaders', () =>
        expect(cfCors.AllowHeaders).to.include('Content-Type'));
      it('Should include "OPTIONS" method at AllowMethods', () =>
        expect(cfCors.AllowMethods).to.include('OPTIONS'));
      it('Should include used method at AllowMethods', () => {
        expect(cfCors.AllowMethods).to.include('GET');
        expect(cfCors.AllowMethods).to.include('POST');
      });
      it('Should not include not used method at AllowMethods', () => {
        expect(cfCors.AllowMethods).to.not.include('PATCH');
        expect(cfCors.AllowMethods).to.not.include('DELETE');
      });
      it('Should allow all origins at AllowOrigins', () =>
        expect(cfCors.AllowOrigins).to.include('*'));
      it('Should not set ExposeHeaders', () => expect(cfCors.ExposeHeaders).to.equal());
      it('Should not set MaxAge', () => expect(cfCors.MaxAge).to.equal());
    });

    describe('Object configuration #1', () => {
      before(() =>
        fixtures
          .extend('httpApi', {
            provider: {
              httpApi: {
                cors: {
                  allowedOrigins: 'https://serverless.com',
                  exposedResponseHeaders: ['Content-Length', 'X-Kuma-Revision'],
                },
              },
            },
          })
          .then(fixturePath =>
            runServerless({
              cwd: fixturePath,
              cliArgs: ['package'],
            }).then(serverless => {
              cfCors =
                serverless.service.provider.compiledCloudFormationTemplate.Resources[
                  serverless.getProvider('aws').naming.getHttpApiLogicalId()
                ].Properties.CorsConfiguration;
            })
          )
      );
      it('Should not set AllowCredentials', () => expect(cfCors.AllowCredentials).to.equal());
      it('Should include default set of headers at AllowHeaders', () =>
        expect(cfCors.AllowHeaders).to.include('Content-Type'));
      it('Should include "OPTIONS" method at AllowMethods', () =>
        expect(cfCors.AllowMethods).to.include('OPTIONS'));
      it('Should include used method at AllowMethods', () => {
        expect(cfCors.AllowMethods).to.include('GET');
        expect(cfCors.AllowMethods).to.include('POST');
      });
      it('Should not include not used method at AllowMethods', () => {
        expect(cfCors.AllowMethods).to.not.include('PATCH');
        expect(cfCors.AllowMethods).to.not.include('DELETE');
      });
      it('Should respect allowedOrigins', () =>
        expect(cfCors.AllowOrigins).to.deep.equal(['https://serverless.com']));
      it('Should respect exposedResponseHeaders', () =>
        expect(cfCors.ExposeHeaders).to.deep.equal(['Content-Length', 'X-Kuma-Revision']));
      it('Should not set MaxAge', () => expect(cfCors.MaxAge).to.equal());
    });

    describe('Object configuration #2', () => {
      before(() =>
        fixtures
          .extend('httpApi', {
            provider: {
              httpApi: {
                cors: {
                  allowCredentials: true,
                  allowedHeaders: ['Authorization'],
                  allowedMethods: ['GET'],
                  maxAge: 300,
                },
              },
            },
          })
          .then(fixturePath =>
            runServerless({
              cwd: fixturePath,
              cliArgs: ['package'],
            }).then(serverless => {
              cfCors =
                serverless.service.provider.compiledCloudFormationTemplate.Resources[
                  serverless.getProvider('aws').naming.getHttpApiLogicalId()
                ].Properties.CorsConfiguration;
            })
          )
      );
      it('Should respect allowCredentials', () => expect(cfCors.AllowCredentials).to.equal(true));
      it('Should respect allowedHeaders', () =>
        expect(cfCors.AllowHeaders).to.deep.equal(['Authorization']));
      it('Should respect allowedMethods', () => expect(cfCors.AllowMethods).to.deep.equal(['GET']));
      it('Should fallback AllowOrigins to default', () =>
        expect(cfCors.AllowOrigins).to.include('*'));
      it('Should not set ExposeHeaders', () => expect(cfCors.ExposeHeaders).to.equal());
      it('Should respect maxAge', () => expect(cfCors.MaxAge).to.equal(300));
    });

    describe('With a catch-all route', () => {
      before(() =>
        fixtures
          .extend('httpApiCatchAll', {
            provider: {
              httpApi: {
                cors: true,
              },
            },
          })
          .then(fixturePath =>
            runServerless({
              cwd: fixturePath,
              cliArgs: ['package'],
            }).then(serverless => {
              cfCors =
                serverless.service.provider.compiledCloudFormationTemplate.Resources[
                  serverless.getProvider('aws').naming.getHttpApiLogicalId()
                ].Properties.CorsConfiguration;
            })
          )
      );
      it('Should respect all allowedMethods', () =>
        expect(cfCors.AllowMethods.sort()).to.deep.equal(
          ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS', 'HEAD', 'DELETE'].sort()
        ));
    });
  });
});
