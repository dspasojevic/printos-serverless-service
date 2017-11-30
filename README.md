# Serverless PrintOS Service 

This is serverless implementation of PrintOS server: http://printos.io

This project uses Serverless Framework: https://github.com/serverless/serverless

Local development


Install Serverless Framework:
```
npm install -g serverless
```

Install packages: 
```
npm install
```

Start API Gateway locally (https://github.com/dherault/serverless-offline):
```
sls offline start
```

Start DynamoDB locally (https://github.com/99xt/serverless-dynamodb-local):
```
sls dynamodb start --migrate
OR (if you already created the tables)
sls dynamodb start
```