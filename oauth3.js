(function () {
  'use strict';

  var oauth3 = {};
  oauth3.states = {};

  if ('undefined' !== typeof Promise) {
    oauth3.PromiseA = Promise;
  }

  oauth3.providePromise = function (PromiseA) {
    var promise;
    var x = 1;

    // tests that this promise has all of the necessary api
    promise = new PromiseA(function (resolve, reject) {
      if (x === 1) {
        throw new Error("bad promise, create not asynchronous");
      }

      PromiseA.resolve().then(function () {
        var promise2;

        if (x === 1 || x === 2) {
          throw new Error("bad promise, resolve not asynchronous");
        }

        promise2 = PromiseA.reject().then(reject, function () {
          if (x === 1 || x === 2 || x === 3) {
            throw new Error("bad promise, reject not asynchronous");
          }

          throw new Error("[NOT AN ERROR] Dear angular users: ignore this error-handling test");
        });

        x = 4;

        return promise2;
      }).catch(function (e) {
        if (e.message.match('NOT AN ERROR')) {
          resolve({ success: true });
        } else {
          reject(e);
        }
      });

      x = 3;
    }).then(function () {
      oauth3.PromiseA = PromiseA;
    });

    x = 2;
    return promise;
  };

  oauth3.stringifyscope = function (scope) {
    if (Array.isArray(scope)) {
      scope = scope.join(' ');
    }
    return scope;
  };

  oauth3.querystringify = function (params) {
    var qs = [];

    Object.keys(params).forEach(function (key) {
      if ('scope' === key) {
        oauth3.stringifyscope(params[key]);
      }
      qs.push(key + '=' + encodeURIComponent(params[key]));
    });

    return qs.join('&');
  };

  oauth3.createState = function () {
    // TODO mo' betta' random function
    // maybe gather some entropy from mouse / keyboard events?
    // (probably not, just use webCrypto or be sucky)
    return parseInt(Math.random().toString().replace('0.', ''), 10).toString('36');
  };

  oauth3.normalizeProviderUri = function (providerUri) {
    // tested with
    //   example.com
    //   example.com/
    //   http://example.com
    //   https://example.com/
    providerUri = providerUri
      .replace(/^(https?:\/\/)?/, 'https://')
      .replace(/\/?$/, '')
      ;

    return providerUri;
  };

  oauth3.realDiscover = function (providerUri) {
    var state = oauth3.createState();
    var params;
    var url;

    return new oauth3.PromiseA(function (resolve/*, reject*/) {
      var $iframe;

      oauth3.states[state] = { close: 'true', action: 'directives' };

      window['__oauth3_' + state] = function (params) {
        console.info('directives found', params);
        resolve(params);
      };

      // logout=true for all logins/accounts
      // logout=app-scoped-login-id for a single login 
      params = {
        action: 'directives'
      , state: state
      , redirect_uri: window.location.protocol + '//' + window.location.host
          + window.location.pathname + 'oauth3.html'
      };

      url = providerUri + '/oauth3.html#' + oauth3.querystringify(params);
      console.log('[local] oauth3 discover', url);

      $iframe = $(
        '<iframe src="' + url
      + '" width="800px" height="800px" style="opacity: 0.8;" frameborder="1"></iframe>'
      //+ '" width="1px" height="1px" style="opacity: 0.01;" frameborder="0"></iframe>'
      );
      $('body').append($iframe);
    });
  };

  oauth3.discover = function (providerUri) {
    var promise;
    var directives;
    var updatedAt;
    var fresh;

    providerUri = oauth3.normalizeProviderUri(providerUri);
    try {
      directives = JSON.parse(localStorage.getItem('oauth3.' + providerUri + '.directives'));
      updatedAt = new Date(localStorage.getItem('oauth3.' + providerUri + '.directives.updated_at')).valueOf();
    } catch(e) {
      // ignore
    }

    fresh = Date.now() - updatedAt < (24 * 60 * 60 * 1000);

    if (directives) {
      promise = oauth3.PromiseA.resolve(directives);
    }

    if (fresh) {
      console.log('[local] [fresh directives]', directives);
      return promise;
    }

    promise = promise || oauth3.realDiscover(providerUri).then(function (params) {
      var err;

      if (!params.directives) {
        err = new Error(params.error_description || "Unknown error when discoving provider '" + providerUri + "'");
        err.code = params.error || "E_UNKNOWN_ERROR";
        return oauth3.PromiseA.reject(err);
      }

      try {
        directives = JSON.parse(atob(params.directives));
      } catch(e) {
        err = new Error(params.error_description || "could not parse directives for provider '" + providerUri + "'");
        err.code = params.error || "E_PARSE_DIRECTIVE";
        return oauth3.PromiseA.reject(err);
      }

      try {
        if (directives.authorization_dialog.url) {
          // TODO lint directives
          localStorage.setItem('oauth3.' + providerUri + '.directives', JSON.stringify(directives));
          localStorage.setItem('oauth3.' + providerUri + '.directives.updated_at', new Date().toISOString());
          return oauth3.PromiseA.resolve(directives);
        }
      } catch(e) {
        // ignore
        console.error("the directives provided by '" + providerUri + "' were invalid.");
        params.error = params.error || "E_INVALID_DIRECTIVE";
        params.error_description = params.error_description
          || "directives did not include authorization_dialog.url";
      }

      err = new Error(params.error_description || "Unknown error when discoving provider '" + providerUri + "'");
      err.code = params.error;
      return oauth3.PromiseA.reject(err);
    });

    return promise;
  };

  oauth3.authorizationRedirect = function (providerUri, scope, apiHost, redirectUri) {
    //
    // Example Authorization Redirect - from Browser to Consumer API
    // (for generating a session securely on your own server)
    //
    // i.e. GET https://<<CONSUMER>>.com/api/oauth3/authorization_redirect/<<PROVIDER>>.com
    //
    // GET https://myapp.com/api/oauth3/authorization_redirect
    //  /`encodeURIComponent('example.com')`
    //  &scope=`encodeURIComponent('profile.login profile.email')`
    //
    // (optional)
    //  &state=`Math.random()`
    //  &redirect_uri=
    //    `encodeURIComponent('https://other.com/'
    //       + '?provider_uri=' + ``encodeURIComponent('https://example.com')``
    //    )`
    //
    // NOTE: This is not a request sent to the provider, but rather a request sent to the
    // consumer (your own API) which then sets some state and redirects.
    // This will initiate the `authorization_code` request on your server
    //

    var state = Math.random().toString().replace(/^0\./, '');
    var params = {};

    params.state = state;
    if (scope) {
      params.scope = scope;
    }
    if (redirectUri) {
      params.redirect_uri = redirectUri;
    }
    if (!apiHost) {
      // TODO oauth3.json for self?
      apiHost = 'https://' + window.location.host;
    }

    oauth3.states[state] = {
      providerUri: providerUri
    , createdAt: new Date().toISOString()
    };

    return oauth3.PromiseA.resolve({
      url: apiHost
        + '/api/oauth3/authorization_redirect/'
        + encodeURIComponent(providerUri.replace(/^(https?|spdy):\/\//, ''))
        + '?' + oauth3.querystringify(params)
    , method: 'GET'
    , state: state    // this becomes browser_state
    , params: params  // includes scope, final redirect_uri?
    });
  };

  oauth3.authorizationCode = function (/*providerUri, scope, redirectUri, clientId*/) {
    //
    // Example Authorization Code Request
    // (not for use in the browser)
    //
    // GET https://example.com/api/oauth3/authorization_dialog
    //  ?response_type=code
    //  &scope=`encodeURIComponent('profile.login profile.email')`
    //  &state=`Math.random()`
    //  &client_id=xxxxxxxxxxx
    //  &redirect_uri=
    //    `encodeURIComponent('https://other.com/'
    //       + '?provider_uri=' + ``encodeURIComponent('https://example.com')``
    //    )`
    //
    // NOTE: `redirect_uri` itself may also contain URI-encoded components
    //
    // NOTE: This probably shouldn't be done in the browser because the server
    //   needs to initiate the state. If it is done in a browser, the browser
    //   should probably request 'state' from the server beforehand
    //

    throw new Error("not implemented");
  };

  oauth3.implicitGrant = function (providerUri, scope, redirectUri, clientId) {
    //
    // Example Implicit Grant Request
    // (for generating a browser-only session, not a session on your server)
    //
    // GET https://example.com/api/oauth3/authorization_dialog
    //  ?response_type=token
    //  &scope=`encodeURIComponent('profile.login profile.email')`
    //  &state=`Math.random()`
    //  &client_id=xxxxxxxxxxx
    //  &redirect_uri=
    //    `encodeURIComponent('https://other.com/'
    //       + '?provider_uri=' + ``encodeURIComponent('https://example.com')``
    //    )`
    //
    // NOTE: `redirect_uri` itself may also contain URI-encoded components
    //
    var type = 'authorization_dialog';
    var responseType = 'token';

    return oauth3.discover(providerUri).then(function (directive) {
      var args = directive[type];
      var uri = args.url;
      var state = Math.random().toString().replace(/^0\./, '');
      var params = {};
      var rparams = { provider_uri: providerUri };
      var loc;
      var result;

      // TODO nix rparams if we can do this with state alone
      oauth3.states[state] = {
        providerUri: providerUri
      , createdAt: new Date().toISOString()
      };

      params.state = state;
      params.response_type = responseType;
      if (scope) {
        if (Array.isArray(scope)) {
          scope = scope.join(' ');
        }
        params.scope = scope;
      }
      if (clientId) {
        // In OAuth3 client_id is optional for implicit grant
        params.client_id = clientId;
      }
      if (!redirectUri) {
        loc = window.location;
        redirectUri = loc.protocol + '//' + loc.host + loc.pathname;
        if ('/' !== redirectUri[redirectUri.length - 1]) {
          redirectUri += '/';
        }
        redirectUri += 'oauth3.html';
      }
      redirectUri += '?' + oauth3.querystringify(rparams);
      params.redirect_uri = redirectUri;
    
      uri += '?' + oauth3.querystringify(params);

      result = {
        url: uri
      , state: state
      , method: args.method
      , query: params
      };
      return oauth3.PromiseA.resolve(result);
    });
  };

  oauth3.resourceOwnerPassword = function (providerUri, username, passphrase, scope, clientId) {
    //
    // Example Resource Owner Password Request
    // (generally for 1st party and direct-partner mobile apps, and webapps)
    //
    // POST https://example.com/api/oauth3/access_token
    //    { "grant_type": "password", "client_id": "<<id>>", "scope": "<<scope>>"
    //    , "username": "<<username>>", "password": "password" }
    //
    var type = 'access_token';
    var grantType = 'password';

    return oauth3.discover(providerUri).then(function (directive) {
      var args = directive[type];
      var params = {
        "grant_type": grantType
      , "username": username
      , "password": passphrase
      };
      var uri = args.url;
      var body;

      if (clientId) {
        params.clientId = clientId;
      }
      if (scope) {
        if (Array.isArray(scope)) {
          scope = scope.join(' ');
        }
        params.scope = scope;
      }

      if ('GET' === args.method.toUpperCase()) {
        uri += '?' + oauth3.querystringify(params);
      } else {
        body = params;
      }

      return {
        url: uri
      , method: args.method
      , data: body
      };
    });
  };

  window.OAUTH3 = oauth3;
  window.oauth3 = oauth3;
}());