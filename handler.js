'use strict';

const AWS = require('aws-sdk');
const _ = require('lodash-fp');
const queryString = require('query-string');

AWS.config.update({ region: 'ap-southeast-2' });

// {
//   region: 'localhost',
//   endpoint: 'http://localhost:8000'
// }
const dynamoDb = new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10' });

const printJobsTableName = 'printJobsTable';
const nextJobIdTableName = 'nextJobIdTable';
const clientsTableName = 'clientsTable';

// PrintOS lookup response expected by PrintOS local server.
const printOSLookupResponse = (pass, ids, items) => ({
  pass: pass,
  version: 5,
  ids: ids,
  data: items
});

// PrintOS print job update response expected by PrintOS local server.
const printOSUpdateResponse = (pass, message) => ({
  pass: pass,
  message: message
});

const printJobStatus = {
  Active: 'Active'
};

module.exports.lookup = (event, context, callback) => {
  const lookupData = queryString.parse(event.body);
  const destination = lookupData.username;
  const password = lookupData.password;

  dbScan(clientsTableName, 'password = :passwordKey and destination = :destinationKey', { ':passwordKey': password, ':destinationKey': destination }, authenticate);

  function authenticate(err, data) {
    if (err) {
      console.log(err);
    }
    // Password and destination is valid.
    if (data && data.Items && data.Items.length > 0) {
      dbScan(printJobsTableName, 'jobStatus = :statusKey and destination = :destinationKey', { ':statusKey': printJobStatus.Active, ':destinationKey': destination }, printJobsResponse);
    }
    // Otherwise, return 400.
    else {
      callback(null, response(400, { message: 'Invalid password or destination.' }));
    }
  }

  function printJobsResponse(err, data) {
    const dataItems = data.Items;
    const ids = _.map((item) => item.jobId)(dataItems)
    const items = _.map((item) => item.data)(dataItems);
    callback(null, response(200, printOSLookupResponse(true, ids, items)));
  }
};

module.exports.submit = (event, context, callback) => {
  dynamoDb.get({
    TableName: nextJobIdTableName,
    Key: {
      id: 1
    }
  }, function (err, data) {
    let nextId = data && data.Item ? data.Item.nextId : 1;

    // Updates or adds.
    dynamoDb.update({
      TableName: nextJobIdTableName,
      Key: { id: 1 },
      UpdateExpression: 'set #a = :x',
      ExpressionAttributeNames: { '#a': 'nextId' },
      ExpressionAttributeValues: {
        ':x': nextId + 1
      }
    }, function () {
      submitJob(event, context, callback, nextId);
    });
  });
}

module.exports.update = (event, context, callback) => {

  // Update POST data from PrintOS local server.
  const updateData = queryString.parse(event.body);
  const printJobId = parseInt(updateData.id, 10);
  const jobStatus = updateData.status;

  dynamoDb.update({
    TableName: printJobsTableName,
    Key: { jobId: printJobId },
    UpdateExpression: 'set #a = :x',
    ExpressionAttributeNames: { '#a': 'jobStatus' },
    ExpressionAttributeValues: {
      ':x': jobStatus
    }
  }, function (err, data) {
    if (err) {
      callback(null, response(200, printOSUpdateResponse(false, err.message)));
    }
    else {
      callback(null, response(200, printOSUpdateResponse(true)));
    }
  });
}

///

function submitJob(event, context, callback, nextJobId) {
  const jobData = JSON.parse(event.body);
  const password = jobData.password;
  const destination = jobData.destination;
  const data = jobData.data;
  const dbParams = {
    TableName: printJobsTableName,
    Item: {
      jobId: nextJobId,
      jobStatus: printJobStatus.Active,
      data: data,
      destination: destination
    }
  };

  if (!password || !destination || !data) {
    callback(null, response(400, {
      message: 'Requires Password and Destination and Data.'
    }));
  }
  else {
    dbScan(clientsTableName, 'password = :passwordKey and destination = :destinationKey', { ':passwordKey': password, ':destinationKey': destination }, authenticate);
  }

  function authenticate(err, data) {
    // Password and destination is valid.
    if (data && data.Items && data.Items.length > 0) {
      dynamoDb.put(dbParams, function (err, data) {
        if (err) {
          callback(null, response(500, {
            message: 'Internal error when creating print job.',
            error: err.message
          }));
        }
        else {
          callback(null, response(200, {
            message: 'Print job submitted successfully.'
          }));
        }
      });
    }
    // Otherwise, return 400.
    else {
      callback(null, response(400, { message: 'Invalid password or destination.' }));
    }
  }
}

function dbScan(tableName, filterExpression, expressionAttributeValues, cb) {
  dynamoDb.scan({
    TableName: tableName,
    FilterExpression: filterExpression,
    ExpressionAttributeValues: expressionAttributeValues
  }, cb)
}

function response(statusCode, data) {
  return {
    statusCode: statusCode,
    body: JSON.stringify(data),
  };
}
