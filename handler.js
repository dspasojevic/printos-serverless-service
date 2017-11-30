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

  authenticate(destination, password, lookingUp, callback);

  function lookingUp(err, data) {
    dbScan(printJobsTableName, 'jobStatus = :statusKey and destination = :destinationKey', { ':statusKey': printJobStatus.Active, ':destinationKey': destination }, printJobsResponse);
  }

  function printJobsResponse(err, data) {
    const dataItems = data.Items;
    const ids = _.map((item) => item.jobId)(dataItems)
    const items = _.map((item) => item.data)(dataItems);
    callback(null, response(200, printOSLookupResponse(true, ids, items)));
  }
};

module.exports.submit = (event, context, callback) => {
  const jobData = JSON.parse(event.body);
  const password = jobData.password;
  const destination = jobData.destination;

  authenticate(destination, password, function () {
    nextJobId().then((nextJobId) => {
      submitJob(event, context, callback, nextJobId, destination);
    });
  }, callback);
}

module.exports.update = (event, context, callback) => {
  // Update POST data from PrintOS local server.
  const updateData = queryString.parse(event.body);
  const printJobId = parseInt(updateData.id, 10);
  const jobStatus = updateData.status;
  const password = updateData.password;
  const destination = updateData.username;

  authenticate(destination, password, updatingJob, callback);

  function updatingJob() {
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
}

module.exports.printJob = (event, context, callback) => {
  console.log(event);
  try {
    const jobId = parseInt(event.queryStringParameters.jobId, 10);
    const destination = event.queryStringParameters.destination;
    const password = event.queryStringParameters.password;
    authenticate(destination, password, function () {
      dbScan(printJobsTableName, 'destination = :destinationKey and jobId = :jobIdKey', { ':jobIdKey': jobId, ':destinationKey': destination }, function (err, data) {
        callback(null, response(200, { printJobs: data.Items }));
      });
    }, callback);
  }
  catch (e) {
    console.log(e.message);
    callback(null, response(400, { message: 'Invalid query parameter.' }));
  }
}

///

function nextJobId() {
  return new Promise((resolve, reject) => dynamoDb.get({
    TableName: nextJobIdTableName,
    Key: {
      id: 1
    }
  }, function (err, data) {
    let nextId = data && data.Item ? data.Item.nextId : 1;
    if (err) {
      reject(err);
    }
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
      resolve(nextId);
    });
  }));
}

function submitJob(event, context, callback, nextJobId, destination) {
  const jobData = JSON.parse(event.body);
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

function authenticate(destination, password, successCb, callback) {
  if (!destination || !password) {
    callback(null, response(400, { message: 'Invalid password or destination.' }));
  }
  else {
    dbScan(clientsTableName, 'password = :passwordKey and destination = :destinationKey', { ':passwordKey': password, ':destinationKey': destination }, function (err, data) {
      if (err) {
        console.log(err);
      }
      // Desitnation and password is validated.
      if (data && data.Items && data.Items.length > 0) {
        successCb();
      }
      else {
        callback(null, response(400, { message: 'Invalid password or destination.' }));
      }
    });
  }
}
