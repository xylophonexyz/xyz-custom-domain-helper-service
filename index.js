const env = require('./env.json');
const request = require('request');
const redis = require('redis');

const dnsProxyName = 'proxy.xylophonexyz.com';
const cloudflareEndpoint = 'https://api.cloudflare.com/client/v4';
const defaultHeaders = {
  'Content-Type': 'application/json',
  'X-Auth-Email': getConfig('CLOUDFLARE_ID'),
  'X-Auth-Key': getConfig('CLOUDFLARE_KEY')
};

exports.handleCreateFullZoneRequest = function handleCreateFullZoneRequest(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const siteId = req.body.siteId;
    const domainName = req.body.domainName;
    const authHeader = getAuthHeader(req);
    validateSiteAuthorWithGet(siteId, authHeader).then(site => {
      createFullZone({siteId: siteId, domainName: domainName, authHeader: authHeader, site: site}).then(zoneData => {
        res.send(zoneData).end();
      }).catch(err => {
        res.status(400).send(readError(err)).end();
      });
    }).catch(err => {
      res.status(401).send(readError(err)).end();
    });
  } catch (e) {
    const error = new Error(paramsMissingError('{domainName, siteId}'));
    res.status(400).send(readError(error)).end();
  }
};

exports.handleDeleteFullZoneRequest = function handleDeleteFullZoneRequest(req, res) {
  const siteId = req.query.siteId;
  const authHeader = getAuthHeader(req);
  res.setHeader('Content-Type', 'application/json');
  validateSiteAuthorWithGet(siteId, authHeader).then(site => {
    deleteZone({siteId: siteId, authHeader: authHeader}, site).then(() => {
      res.send({message: 'Domain deleted successfully'}).end();
    }).catch(err => {
      res.status(400).send(readError(err)).end();
    });
  }).catch(err => {
    res.status(401).send(readError(err)).end();
  });
};

exports.handleInsertKeyPairRequest = function handleInsertKeyPairRequest(req, res) {
  try {
    const siteId = req.body.siteId;
    const domainName = req.body.domainName;
    const authHeader = getAuthHeader(req);
    res.setHeader('Content-Type', 'application/json');
    validateSiteAuthorWithGet(siteId, authHeader).then(site => {
      const landingPageId = getLandingPageId(site);
      insertKeyPair(domainName, 'siteId', siteId).then(() => {
        insertKeyPair(domainName, 'landingPageId', landingPageId).then(() => {
          res.send({
            success: true,
            message: `Please add a CNAME record that points ${domainName} to proxy.xylophonexyz.com`
          }).end();
        }).catch(err => res.status(400).send(readError(err)).end());
      }).catch(err => res.status(400).send(readError(err)).end());
    }).catch(err => res.status(401).send(readError(err)).end());
  } catch (e) {
    const error = new Error(paramsMissingError('{domainName, siteId}'));
    res.status(400).send({error: readError(error)}).end();
  }
};

exports.handleClearLandingPageIdRequest = function handleClearLandingPageIdRequest(req, res) {
  try {
    const siteId = req.body.siteId;
    const domainName = req.body.domainName;
    const authHeader = getAuthHeader(req);
    res.setHeader('Content-Type', 'application/json');
    validateSiteAuthorWithGet(siteId, authHeader).then(site => {
      removeField(domainName, 'landingPageId').then(() => {
        res.send({success: true}).end();
      }).catch(err => {
        res.status(400).send(readError(err)).end();
      });
    }).catch(err => res.status(401).send(readError(err)).end());
  } catch (e) {
    const error = new Error(paramsMissingError('{domainName, siteId}'));
    res.status(400).send({error: readError(error)}).end();
  }
};

exports.handleDeleteKeyPairRequest = function handleDeleteKeyPairRequest(req, res) {
  try {
    const siteId = req.body.siteId;
    const domainName = req.body.domainName;
    const authHeader = getAuthHeader(req);
    res.setHeader('Content-Type', 'application/json');
    validateSiteAuthorWithGet(siteId, authHeader).then(() => {
      removeKey(domainName).then(() => {
        res.send({success: true}).end();
      }).catch(err => {
        res.status(400).send(readError(err)).end();
      });
    }).catch(err => {
      res.status(401).send(readError(err)).end();
    });
  } catch (e) {
    const error = new Error(paramsMissingError('{domainName, siteId}'));
    res.status(400).send({error: readError(error)}).end();
  }
};

function validateSiteAuthorWithGet(siteId, authHeader) {
  return new Promise((resolve, reject) => {
    const url = `${getConfig('API_ENDPOINT')}/v1/compositions/${siteId}`;
    const headers = {'Authorization': authHeader, 'Content-Type': 'application/json'};
    const params = {
      method: 'GET',
      url: url,
      headers: headers,
    };
    request(params, (err, __, siteData) => {
      if (err) {
        reject(err.message);
      } else {
        const validationUrl = `${getConfig('API_ENDPOINT')}/v1/me`;
        const validationParams = {
          method: 'GET',
          url: validationUrl,
          headers: headers
        };
        request(validationParams, (validationErr, _, userData) => {
          try {
            const site = JSON.parse(siteData);
            const user = JSON.parse(userData);
            if (validationErr) {
              reject(validationErr);
            } else {
              if (site.user.id === user.id) {
                resolve(site);
              } else {
                reject('Not allowed. Current user does not own resource');
              }
            }
          } catch (e) {
            const error = new Error('Unable to determine site author');
            reject(error);
          }
        });
      }
    });
  });
}

function createFullZone(params) {
  return new Promise((resolve, reject) => {
    createZone(params.domainName).then(createZoneResult => {
      const mappings = ['addRootDnsResult', 'enableAlwaysUseHttpsResult', 'insertKeyPairResult'];
      const landingPageId = getLandingPageId(params.site);
      const promises = [
        addRootDnsRecord(createZoneResult.result),
        enableAlwaysUseHttps(createZoneResult.result),
        insertKeyPair(params.domainName, 'siteId', params.siteId),
        insertKeyPair(`www.${params.domainName}`, 'siteId', params.siteId),
        insertKeyPair(params.domainName, 'landingPageId', landingPageId),
        insertKeyPair(`www.${params.domainName}`, 'landingPageId', landingPageId),
      ];
      Promise.all(promises).then(results => {
        const response = {createZoneResult: createZoneResult};
        results.map((result, index) => response[mappings[index]] = result);
        // this request is optional, we would like to proceed even if this fails
        addWwwDnsRecord(createZoneResult.result).then(addWwwDnsResult => {
          response['addWwwDnsResult'] = addWwwDnsResult;
          resolve(response);
        }, () => {
          resolve(response);
        });
      }, err => {
        deleteZone({
          siteId: params.siteId,
          domainName: params.domainName,
          authHeader: params.authHeader,
          zoneId: createZoneResult.id
        }).then(() => reject(err), deleteZoneErr => reject({error: err, deleteZoneError: deleteZoneErr}));
      });
    }, err => reject(err));
  });
}

function createZone(domainName) {
  return new Promise((resolve, reject) => {
    const url = `${cloudflareEndpoint}/zones`;
    const payload = {
      url: url,
      method: 'POST',
      headers: defaultHeaders,
      body: createZonePayload(domainName)
    };
    request(payload, (err, _, responseBody) => {
      handleRequestResponse(err, responseBody, reject, resolve);
    });
  });
}

function addDnsRecord(zone, requestBody) {
  return new Promise((resolve, reject) => {
    const url = `${cloudflareEndpoint}/zones/${zone.id}/dns_records`;
    const payload = {
      url: url,
      method: 'POST',
      headers: defaultHeaders,
      body: requestBody
    };
    request(payload, (err, _, responseBody) => {
      handleRequestResponse(err, responseBody, reject, resolve);
    });
  });
}

function addWwwDnsRecord(zone) {
  return addDnsRecord(zone, createWwwDnsPayload());
}

function addRootDnsRecord(zone) {
  return addDnsRecord(zone, createRootDnsPayload());
}

function deleteZone(params, site) {
  return new Promise((resolve, reject) => {
    if (params.siteId && params.authHeader) {
      const zoneId = params.zoneId || (site.metadata.customDomain ? site.metadata.customDomain.zoneId : null);
      const domainName = site.metadata.customDomain ? site.metadata.customDomain.domainName : null;
      if (zoneId) {
        const url = `${cloudflareEndpoint}/zones/${zoneId}`;
        const payload = {
          method: 'DELETE',
          url: url,
          headers: defaultHeaders
        };
        request(payload, (err, _, res) => {
          if (err) {
            reject(err);
          } else {
            removeKey(domainName).then(() => {
              removeKey(`www.${domainName}`).then(() => {
                resolve(res);
              });
            }).catch(err => {
              console.log('Failed to remove key from redis', err);
              resolve(res);
            });
          }
        });
      } else {
        reject(paramsMissingError('{zoneId}'));
      }
    } else {
      reject(paramsMissingError('{authHeader, siteId}'));
    }
  });
}

function insertKeyPair(domainName, key, value) {
  return new Promise((resolve, reject) => {
    const client = redis.createClient({
      host: getConfig('REDIS_HOST'),
      port: getConfig('REDIS_PORT'),
      db: getConfig('REDIS_DB')
    });
    client.on('error', err => {
      client.quit();
      reject(err.message);
    });
    client.hset(domainName, key, value, () => {
      client.quit();
      resolve(true);
    });
  });
}

function removeKey(key) {
  return new Promise((resolve, reject) => {
    const client = redis.createClient({
      host: getConfig('REDIS_HOST'),
      port: getConfig('REDIS_PORT'),
      db: getConfig('REDIS_DB')
    });
    client.on('error', err => {
      client.quit();
      reject(err.message);
    });
    client.del(key, () => {
      client.quit();
      resolve(true);
    });
  });
}

function removeField(key, field) {
  return new Promise((resolve, reject) => {
    const client = redis.createClient({
      host: getConfig('REDIS_HOST'),
      port: getConfig('REDIS_PORT'),
      db: getConfig('REDIS_DB')
    });
    client.on('error', err => {
      client.quit();
      reject(err.message);
    });
    client.hdel(key, field, () => {
      client.quit();
      resolve(true);
    });
  });
}

function enableAlwaysUseHttps(zone) {
  return new Promise((resolve, reject) => {
    const url = `${cloudflareEndpoint}/zones/${zone.id}/settings/always_use_https`;
    const payload = {
      url: url,
      method: 'PATCH',
      headers: defaultHeaders,
      body: createAlwaysUseHttpsPayload()
    };
    request(payload, (err, _, responseBody) => {
      handleRequestResponse(err, responseBody, reject, resolve);
    });
  });
}

function handleRequestResponse(err, responseBody, reject, resolve) {
  if (err) {
    reject(err.message);
  } else {
    const body = JSON.parse(responseBody);
    if (body.success) {
      resolve(body);
    } else {
      reject(responseBody);
    }
  }
}

function createZonePayload(domainName) {
  return JSON.stringify({
    name: domainName,
    jump_start: true
  });
}

function createAlwaysUseHttpsPayload() {
  return JSON.stringify({
    value: 'on',
  });
}

function createRootDnsPayload() {
  return JSON.stringify({
    type: 'CNAME',
    name: '@',
    content: dnsProxyName,
    proxied: true
  });
}

function createWwwDnsPayload() {
  return JSON.stringify({
    type: 'CNAME',
    name: 'www',
    content: dnsProxyName,
    proxied: true
  });
}

function getAuthHeader(req) {
  try {
    return req.headers.Authorization || req.headers.authorization;
  } catch (e) {
    return '';
  }
}

function getConfig(key) {
  return env[key];
}

function paramsMissingError(params) {
  return `One or more required parameters missing: ${params}`;
}

function readError(err) {
  return err.message ? err.message : err;
}

function getLandingPageId(site) {
  const pages = site.pages.filter(page => page.metadata && page.metadata.navigationItem);
  const page = pages.sort((a, b) => {
    if (a.metadata.index < b.metadata.index) {
      return 1;
    } else if (a.metadata.index > b.metadata.index) {
      return -1;
    } else {
      return 0;
    }
  }).pop();
  if (page) {
    return page.id;
  } else {
    return null;
  }
}