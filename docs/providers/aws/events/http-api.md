<!--
title: Serverless Framework - AWS Lambda Events - HTTP API
menuText: HTTP API
menuOrder: 2
description: Setting up API Gateway HTTP APIs with AWS Lambda via the Serverless Framework
layout: Doc
-->

<!-- DOCS-SITE-LINK:START automatically generated  -->

### [Read this on the main serverless docs site](https://www.serverless.com/framework/docs/providers/aws/events/http-api)

<!-- DOCS-SITE-LINK:END -->

# HTTP API

HTTP APIs are a special flavored [API Gateway](https://aws.amazon.com/api-gateway/) implementation which offer more features and improved performance.

The Serverless Framework makes it possible to setup [API Gateway](https://aws.amazon.com/api-gateway/) HTTP APIs via the `httpApi` event.

## Event Definition

### General setup

```yaml
functions:
  simple:
    handler: handler.simple
    events:
      - httpApi: 'PATCH /elo'
  extended:
    handler: handler.extended
    events:
      - httpApi:
          method: POST
          path: /post/just/to/this/path
```

### Catch-alls

```yaml
functions:
  catchAllAny:
    handler: index.catchAllAny
    events:
      - httpApi: '*'
  catchAllMethod:
    handler: handler.catchAllMethod
    events:
      - httpApi:
          method: '*'
          path: /any/method
```

### Parameters

```yaml
functions:
  params:
    handler: handler.params
    events:
      - httpApi:
          method: GET
          path: /get/for/any/{param}
```

## CORS Setup

With HTTP API we may configure CORS headers that'll be effective for all configured endpoints.

Default CORS configuration can be turned on with:

```yaml
provider:
  httpApi:
    cors: true
```

It'll result with headers as:

| Header                       | Value                                                                                       |
| :--------------------------- | :------------------------------------------------------------------------------------------ |
| Access-Control-Allow-Origin  | \*                                                                                          |
| Access-Control-Allow-Headers | Content-Type, X-Amz-Date, Authorization, X-Api-Key, X-Amz-Security-Token, X-Amz-User-Agent) |
| Access-Control-Allow-Methods | OPTIONS, _(...all defined in endpoints)_                                                    |

If there's a need to fine tune CORS headers, then each can be configured individually as follows:

```yaml
provider:
  httpApi:
    cors:
      allowedOrigins:
        - https://url1.com
        - https://url2.com
      allowedHeaders:
        - Content-Type
        - Authorization
      allowedMethods:
        - GET
      allowCredentials: true
      exposedResponseHeaders:
        - Special-Response-Header
      maxAge: 6000 # In seconds
```
