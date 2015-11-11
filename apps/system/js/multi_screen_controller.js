/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */
/* global ActionMenu, BaseModule, LazyLoader, BroadcastChannel */
'use strict';

(function() {
  var MultiScreenController = function() {};
  MultiScreenController.SUB_MODULES = [
    'RemoteTouchPanel'
  ];

  MultiScreenController.SERVICES = [
    'queryExternalDisplays',
    'chooseDisplay',
    'remoteTouch'
  ];

  MultiScreenController.EVENTS = [
    'mozChromeEvent'
  ];

  BaseModule.create(MultiScreenController, {
    name: 'MultiScreenController',

    EVENT_PREFIX: 'remote-',
    DEBUG: true,

    chooseDisplay: function(config) {
      this.debug('chooseDisplay is invoked');

      if (config.isSystemMessage || config.stayBackground) {
        this.debug('unsupported config: ' + JSON.stringify(config));
        return Promise.reject();
      }

      return this.queryExternalDisplays()
        .then(this.showMenu.bind(this))
        .then((displayId) => {
          this.debug('chosen display id: ' + displayId);

          if (!displayId) {
            return Promise.reject();
          }

          this.postMessage(displayId, 'launch-app', config);
          return Promise.resolve(displayId);
        });
    },

    showMenu: function(deviceList) {
      this.debug('showMenu is invoked');

      if (this.actionMenu) {
        this.debug('actionMenu is busy');
        return Promise.reject();
      }

      if (!deviceList.length) {
        this.debug('no external display so cancel the menu directly');
        return Promise.resolve();
      }

      return new Promise((resolve, reject) => {
        LazyLoader.load('js/action_menu.js', () => {
          this.actionMenu = new ActionMenu({
            successCb: (choice) => {
              this.actionMenu = null;
              resolve(choice);
            },
            cancelCb: () => {
              this.actionMenu = null;
              resolve();
            }
          });

          this.actionMenu.show(deviceList.map(function(display) {
            return {
              label: display.name,
              value: display.id
            };
          }), 'multiscreen-pick');
        });
      });
    },

    queryExternalDisplays: function() {
      this.debug('queryExternalDisplays is invoked');

      var mozPresentationDeviceInfo = window.navigator.mozPresentationDeviceInfo;
      if (typeof mozPresentationDeviceInfo === 'undefined') {
        this.debug("mozPresentationDeviceInfo is undefined");
        return Promise.reject();
      }

      mozPresentationDeviceInfo.forceDiscovery();
      return mozPresentationDeviceInfo.getAll();
    },

    postMessage: function(target, type, detail) {
      if (type != 'remote-touch') {
        this.debug('broadcast message to #' + target + ': ' +
          type + ', ' + JSON.stringify(detail));
      }

      this.broadcastChannel.postMessage({
        target: target,
        type: type,
        detail: detail
      });
    },

    remoteTouch: function(evt) {
      var touch =
        (evt.type == 'touchend') ? evt.changedTouches[0] : evt.touches[0];

      this.postMessage(-1, 'remote-touch', {
        type: evt.type,
        touch: {
          pageX: touch.pageX,
          pageY: touch.pageY,
          identifier: touch.identifier,
          radiusX: touch.radiusX,
          radiusY: touch.radiusY,
          rotationAngle: touch.rotationAngle,
          force: touch.force,
          width: screen.width,
          height: screen.height
        }
      });
    },

    _start: function() {
      this._enabled = false;
      this.actionMenu = null;
      this.queryPromiseCallback = null;

      this.broadcastChannel = new BroadcastChannel('multiscreen');
      this.broadcastChannel.addEventListener('message', this);

			window.addEventListener('mozChromeEvent', this);
    },

    _stop: function() {
      if (this._enabled) {
        window.removeEventListener('mozChromeEvent', this);
        this._enabled = false;
      }

      this.broadcastChannel.close();
      this.broadcastChannel = null;

      if (this.queryPromiseCallback) {
        this.queryPromiseCallback.reject('module has been stoped');
        this.queryPromiseCallback = null;
      }
      if (this.actionMenu) {
        this.actionMenu.hide();
        if (this.actionMenu.oncancel) {
          this.actionMenu.oncancel();
        }
        this.actionMenu = null;
      }
    },

    _handle_mozChromeEvent: function(evt) {
      var detail = evt.detail;

      if (!this.queryPromiseCallback) {
        return;
      }

      switch (detail.type) {
        case 'get-display-list-success':
          this.queryPromiseCallback.resolve(detail.display);
          break;
        case 'get-display-list-error':
          this.queryPromiseCallback.reject(detail.error);
          break;
        default:
          return;
      }

      this.queryPromiseCallback = null;
      this.debug('got mozChromeEvent: ' + JSON.stringify(detail));
    },

    _handle_message: function(evt) {
      var data = evt.data;
      if (data.target !== undefined) {
        return;
      }
      this.debug('got message from #' + data.source + ': ' +
        data.type + ', ' + JSON.stringify(data.detail));

      switch(data.type) {
        case 'launch-app-success':
        case 'launch-app-error':
          this.publish(data.type, {
            displayId: data.source,
            config: data.detail.config,
            reason: data.detail.reason
          });
          break;
      }
    }
  });
}());
