const http = require('http');
const fs = require('fs');
const YAML = require('yaml');

const port = 3000;

const apis = {
  GET: {},
  POST: {},
  PUT: {},
  DELETE: {}
};

const regexMapping = {
  integer: '\\d+',
  string: '[A-Za-z]+'
};

init();

function init() {
  const file = fs.readFileSync('./api.yaml', 'utf8');
  const parsedYaml = YAML.parse(file);
  createApis(parsedYaml);
  console.log(apis);
  startServer();
}

function createApis(parsedYaml) {
  const paths = parsedYaml.paths;
  for (const path of Object.keys(paths)) {
    const details = paths[path];
    for (const method of Object.keys(details)) {
      const regex = generatePathRegex(path, details[method].parameters);
      const handler = getHandler(details[method]['x-handler']);;
      // Go ahead only if we have allowed method and handler
      if (apis[method.toUpperCase()] && handler) {
        // TODO: Add validation object to every API
        apis[method.toUpperCase()][path] = {
          handler,
          regex
        };
      }
    }
  }
}

function generatePathRegex(path, parameters) {
  const basePath = path.split('/')[1];
  let regexStr = `/${basePath}`;
  if (!parameters) {
    return new RegExp(`${regexStr}$`, 'g');
  }
  const pathParams = parameters.filter(p => p.in === 'path');
  if (!pathParams || pathParams && pathParams.length === 0) {
    return new RegExp(`${regexStr}$`, 'g');
  }
  pathParams.forEach(p => {
    regexStr += `/${regexMapping[p.type]}`;
  });
  return new RegExp(`${regexStr}$`, 'g');
}

function getHandler(handlerName) {
  if (!handlerName) {
    return undefined;
  }
  try {
    return require(`./handlers/${handlerName}`);
  } catch (e) {
    // If any error requiring handler, let's return undefined
    return undefined;
  }
}

function runSyncMiddlewares(request, response) {
  setResponseHeaders(request, response);
  updateRequestObject(request, response);
  updateResponseObject(request, response);
}

function handler(request, response) {
  try {
    runSyncMiddlewares(request, response);
    fwdToRightHandler(request, response);
    notFoundHandler(request, response);
    // attachBody(request)
    //   .then(() => {
    //     response.json();
    //   })
    //   .catch(err => {
    //     genericErrorHandler(request, response, err);
    //   })
  } catch (e) {
    genericErrorHandler(request, response, e);
  }
}

function startServer() {
  const server = http.createServer(handler);
  server.listen(port, () => {
    console.log(`Server started on port ${port}`);
  });
}

function attachBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk.toString();
    });
    request.on('end', () => {
      try {
        request.body = JSON.parse(body);
        return resolve();
      } catch (e) {
        // return reject(e);
        return resolve();
      }
    });    
  });
}

function genericErrorHandler(request, response, error) {
  console.log('Generic Error Handler!', error);
  return response.json({message: 'Server Error'}, 500);
}

function setResponseHeaders(request, response) {
  response.setHeader('Content-Type', 'application/json');
  return;
}

function updateRequestObject(request, response) {
  extractQParams(request);
  request.url = stripTrailingSlash(request.url);
}

function updateResponseObject(request, response) {
  response.json = (payload, statusCode) => {
    response.statusCode = statusCode ? statusCode : 200;
    return payload ? response.end(JSON.stringify(payload)) : response.end(JSON.stringify({}));
  };
  return;
}

function fwdToRightHandler(request, response) {
  const url = request.url;
  const method = request.method;
  console.log('METHOD', method);
  console.log('URL', url);
  console.log('Q', request.query);
  if (!apis[method]) {
    return response.json({ message: 'Method not found'}, 404);
  }
  if (apis[method][url]) {
    // TODO: Validation
    return apis[method][url].handler(request, response);
  } else {
    // looks like we have path params, let's try to find the right handler for this one
    const routes = Object.keys(apis[method]);
    const found = routes.filter(r => apis[method][r].regex.test(url));
    if (found && found.length > 0) {
      return apis[method][found[0]].handler(request, response);
    }
  }
}

function notFoundHandler(request, response) {
  return response.json({ message: 'Handler not found'}, 404);
}


function stripTrailingSlash(url) {
  const urlLen = url.length - 1;
  if (url !== '/' && url[urlLen] === '/') {
    return url.slice(0, urlLen);
  }
  return url;
}

function extractQParams(request) {
  let q = '';
  if (request.url.includes('?')) {
    const indexOfQ = request.url.indexOf('?');
    q = request.url.slice(indexOfQ + 1, request.url.length);
    request.url = request.url.slice(0, indexOfQ);
  }
  const query = {};
  q.split('&').forEach(t => {
    const temp = t.split('=');
    temp.forEach((key, index) => {
      if ((index + 1) % 2 !== 0) {
        query[key] = '';
      } else {
        const prevKey = temp[index - 1];
        query[prevKey] = key;
      }
    })
  });
  request.query = query;
}
