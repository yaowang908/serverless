'use strict';

const _ = require('lodash');
const d = require('d');
const memoizee = require('memoizee');
const memoizeeMethods = require('memoizee/methods');

const allowedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS', 'HEAD', 'DELETE']);
const methodPathPattern = /^([a-zA-Z]+) (.+)$/;

const resolveTargetConfig = memoizee(({ functionLogicalId, functionAlias }) => {
  const functionArnGetter = { 'Fn::GetAtt': [functionLogicalId, 'Arn'] };
  if (!functionAlias) return functionArnGetter;
  return { 'Fn::Join': [':', [functionArnGetter, functionAlias.name]] };
});

const defaultCors = {
  allowedOrigins: new Set(['*']),
  allowedHeaders: new Set([
    'Content-Type',
    'X-Amz-Date',
    'Authorization',
    'X-Api-Key',
    'X-Amz-Security-Token',
    'X-Amz-User-Agent',
  ]),
};

const toSet = item => new Set(Array.isArray(item) ? item : [item]);

class HttpApiEvents {
  constructor(serverless) {
    this.serverless = serverless;
    this.provider = this.serverless.getProvider('aws');
    serverless.httpApiEventsPlugin = this;

    this.hooks = {
      'package:compileEvents': () => {
        this.resolveConfiguration();
        if (!this.config.routes.size) return;
        this.cfTemplate = this.serverless.service.provider.compiledCloudFormationTemplate;
        this.compileApi();
        this.compileStage();
        this.compileEndpoints();
      },
    };
  }
  compileApi() {
    const properties = {
      Name: this.provider.naming.getHttpApiName(),
      ProtocolType: 'HTTP',
    };
    if (this.config.routes.has('*')) {
      properties.RouteKey = '$default';
      properties.Target = resolveTargetConfig(this.config.routes.get('*'));
    }
    const cors = this.config.cors;
    if (cors) {
      properties.CorsConfiguration = {
        AllowCredentials: cors.allowCredentials,
        AllowHeaders: Array.from(cors.allowedHeaders),
        AllowMethods: Array.from(cors.allowedMethods),
        AllowOrigins: Array.from(cors.allowedOrigins),
        ExposeHeaders: cors.exposedResponseHeaders && Array.from(cors.exposedResponseHeaders),
        MaxAge: cors.maxAge,
      };
    }
    this.cfTemplate.Resources[this.provider.naming.getHttpApiLogicalId()] = {
      Type: 'AWS::ApiGatewayV2::Api',
      Properties: properties,
    };
  }
  compileStage() {
    if (!this.config.routes.has('*')) {
      this.cfTemplate.Resources[this.provider.naming.getHttpApiStageLogicalId()] = {
        Type: 'AWS::ApiGatewayV2::Stage',
        Properties: {
          ApiId: { Ref: this.provider.naming.getHttpApiLogicalId() },
          StageName: '$default',
          AutoDeploy: true,
        },
      };
    }
    this.cfTemplate.Outputs.HttpApiUrl = {
      Description: 'URL of the HTTP API',
      Value: {
        'Fn::Join': [
          '',
          [
            'https://',
            { Ref: this.provider.naming.getHttpApiLogicalId() },
            '.execute-api.',
            { Ref: 'AWS::Region' },
            '.',
            { Ref: 'AWS::URLSuffix' },
          ],
        ],
      },
    };
  }
  compileEndpoints() {
    for (const [routeKey, routeTargetData] of this.config.routes) {
      this.compileLambdaPermissions(routeTargetData);
      if (routeKey === '*') continue;
      this.compileIntegration(routeTargetData);
      this.cfTemplate.Resources[this.provider.naming.getHttpApiRouteLogicalId(routeKey)] = {
        Type: 'AWS::ApiGatewayV2::Route',
        Properties: {
          ApiId: { Ref: this.provider.naming.getHttpApiLogicalId() },
          RouteKey: routeKey,
          Target: {
            'Fn::Join': [
              '/',
              [
                'integrations',
                {
                  Ref: this.provider.naming.getHttpApiIntegrationLogicalId(
                    routeTargetData.functionName
                  ),
                },
              ],
            ],
          },
        },
        DependsOn: this.provider.naming.getHttpApiIntegrationLogicalId(
          routeTargetData.functionName
        ),
      };
    }
  }
}

Object.defineProperties(
  HttpApiEvents.prototype,
  memoizeeMethods({
    resolveConfiguration: d(function() {
      const routes = new Map();
      this.config = { routes };
      const userConfig = this.serverless.service.provider.httpApi || {};
      let cors = null;
      let shouldFillCorsMethods = false;
      const userCors = userConfig.cors;
      if (userCors) {
        cors = this.config.cors = {};
        if (userConfig.cors === true) {
          Object.assign(cors, defaultCors);
          shouldFillCorsMethods = true;
        } else {
          cors.allowedOrigins = userCors.allowedOrigins
            ? toSet(userCors.allowedOrigins)
            : defaultCors.allowedOrigins;
          cors.allowedHeaders = userCors.allowedHeaders
            ? toSet(userCors.allowedHeaders)
            : defaultCors.allowedHeaders;
          if (userCors.allowedMethods) cors.allowedMethods = toSet(userCors.allowedMethods);
          else shouldFillCorsMethods = true;
          if (userCors.allowCredentials) cors.allowCredentials = true;
          if (userCors.exposedResponseHeaders) {
            cors.exposedResponseHeaders = toSet(userCors.exposedResponseHeaders);
          }
          cors.maxAge = userCors.maxAge;
        }
        if (shouldFillCorsMethods) cors.allowedMethods = new Set(['OPTIONS']);
      }

      for (const [functionName, functionData] of _.entries(this.serverless.service.functions)) {
        const routeTargetData = {
          functionName,
          functionAlias: functionData.targetAlias,
          functionLogicalId: this.provider.naming.getLambdaLogicalId(functionName),
        };
        for (const event of functionData.events) {
          if (!event.httpApi) continue;
          let method;
          let path;
          if (_.isObject(event.httpApi)) {
            ({ method, path } = event.httpApi);
          } else {
            const methodPath = String(event.httpApi);
            if (methodPath === '*') {
              path = '*';
            } else {
              const tokens = methodPath.match(methodPathPattern);
              if (!tokens) {
                throw new this.serverless.classes.Error(
                  `Invalid "<method> <path>" route in function  ${functionName} for httpApi event in serverless.yml`,
                  'INVALID_HTTP_API_ROUTE'
                );
              }
              [, method, path] = tokens;
            }
          }
          if (!path) {
            throw new this.serverless.classes.Error(
              `Missing "path" property in function ${functionName} for httpApi event in serverless.yml`,
              'MISSING_HTTP_API_PATH'
            );
          }
          path = String(path);
          let routeKey;
          if (path === '*') {
            if (method && method !== '*') {
              throw new this.serverless.classes.Error(
                `Invalid "path" property in function ${functionName} for httpApi event in serverless.yml`,
                'INVALID_HTTP_API_PATH'
              );
            }
            routeKey = '*';
            event.resolvedMethod = 'ANY';
          } else {
            if (!method) {
              throw new this.serverless.classes.Error(
                `Missing "method" property in function ${functionName} for httpApi event in serverless.yml`,
                'MISSING_HTTP_API_METHOD'
              );
            }
            method = String(method).toUpperCase();
            if (method === '*') {
              method = 'ANY';
              if (
                Array.from(
                  allowedMethods,
                  allowedMethod => `${allowedMethod} ${path}`
                ).some(duplicateRouteKey => routes.has(duplicateRouteKey))
              ) {
                throw new this.serverless.classes.Error(
                  `Duplicate method for "${path}" path in function ${functionName} for httpApi event in serverless.yml`,
                  'DUPLICATE_HTTP_API_METHOD'
                );
              }
            } else {
              if (!allowedMethods.has(method)) {
                throw new this.serverless.classes.Error(
                  `Invalid "method" property in function ${functionName} for httpApi event in serverless.yml`,
                  'INVALID_HTTP_API_METHOD'
                );
              }
              if (routes.has(`ANY ${path}`)) {
                throw new this.serverless.classes.Error(
                  `Duplicate method for "${path}" path in function ${functionName} for httpApi event in serverless.yml`,
                  'DUPLICATE_HTTP_API_METHOD'
                );
              }
            }
            event.resolvedMethod = method;
            event.resolvedPath = path;
            routeKey = `${method} ${path}`;

            if (routes.has(routeKey)) {
              throw new this.serverless.classes.Error(
                `Duplicate route '${routeKey}' configuration in function ${functionName} for httpApi event in serverless.yml`,
                'DUPLICATE_HTTP_API_ROUTE'
              );
            }
          }
          routes.set(routeKey, routeTargetData);
          if (shouldFillCorsMethods) {
            if (event.resolvedMethod === 'ANY') {
              for (const allowedMethod of allowedMethods) {
                cors.allowedMethods.add(allowedMethod);
              }
            } else {
              cors.allowedMethods.add(event.resolvedMethod);
            }
          }
        }
      }
    }),
    compileIntegration: d(function(routeTargetData) {
      this.cfTemplate.Resources[
        this.provider.naming.getHttpApiIntegrationLogicalId(routeTargetData.functionName)
      ] = {
        Type: 'AWS::ApiGatewayV2::Integration',
        Properties: {
          ApiId: { Ref: this.provider.naming.getHttpApiLogicalId() },
          IntegrationType: 'AWS_PROXY',
          IntegrationUri: resolveTargetConfig(routeTargetData),
          PayloadFormatVersion: '1.0',
        },
      };
    }),
    compileLambdaPermissions: d(function(routeTargetData) {
      this.cfTemplate.Resources[
        this.provider.naming.getLambdaHttpApiPermissionLogicalId(routeTargetData.functionName)
      ] = {
        Type: 'AWS::Lambda::Permission',
        Properties: {
          FunctionName: resolveTargetConfig(routeTargetData),
          Action: 'lambda:InvokeFunction',
          Principal: 'apigateway.amazonaws.com',
          SourceArn: {
            'Fn::Join': [
              '',
              [
                'arn:',
                { Ref: 'AWS::Partition' },
                ':execute-api:',
                { Ref: 'AWS::Region' },
                ':',
                { Ref: 'AWS::AccountId' },
                ':',
                { Ref: this.provider.naming.getHttpApiLogicalId() },
                '/*',
              ],
            ],
          },
        },
        DependsOn: routeTargetData.functionAlias
          ? routeTargetData.functionAlias.logicalId
          : undefined,
      };
    }),
  })
);

module.exports = HttpApiEvents;
