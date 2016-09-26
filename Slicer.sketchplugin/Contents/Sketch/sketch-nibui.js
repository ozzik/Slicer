/*
 * Copyright 2015 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

function NibUI(context, bundleResourceName, nibName, bindViewNames) {
  bindViewNames = bindViewNames || [];

  var bundlePath = context.plugin.urlForResourceNamed(bundleResourceName).path();
  this._bundle = NSBundle.bundleWithPath(bundlePath);

  var superclass = NSClassFromString('NSObject');

  // create a class name that doesn't exist yet. note that we can't reuse the same
  // definition lest Sketch will throw an MOJavaScriptException when binding the UI,
  // probably due to JavaScript context / plugin lifecycle incompatibility

  var tempClassName;
  while (true) {
    tempClassName = 'NibOwner' + _randomId();
    if (NSClassFromString(tempClassName) == null) {
      break;
    }
  }

  var me = this;

  // register the temporary class and set up instance methods that will be called for
  // each bound view

  this._cls = MOClassDescription.allocateDescriptionForClassWithName_superclass_(tempClassName, superclass);

  bindViewNames.forEach(function(bindViewName) {
    var setterName = 'set' + bindViewName.substring(0, 1).toUpperCase() + bindViewName.substring(1);
    me._cls.addInstanceMethodWithSelector_function_(
      NSSelectorFromString(setterName + ':'),
      function(arg) {
        me[bindViewName] = arg;
      });
  });

  this._cls.registerClass();
  this._nibOwner = NSClassFromString(tempClassName).alloc().init();

  // Radio button thingy
  var selector = NSSelectorFromString('radioButtonSelected:');
  this._cls.addInstanceMethodWithSelector_function_(
    selector,
    function() {});

  var tloPointer = MOPointer.alloc().initWithValue(null);

  if (this._bundle.loadNibNamed_owner_topLevelObjects_(nibName, this._nibOwner, tloPointer)) {
    var topLevelObjects = tloPointer.value();
    for (var i = 0; i < topLevelObjects.count(); i++) {
      var obj = topLevelObjects.objectAtIndex(i);
      if (obj.className().endsWith('View')) {
        this.view = obj;
        break;
      }
    }
  } else {
    throw new Error('Could not load nib');
  }
}

function _randomId() {
  return (1000000 * Math.random()).toFixed(0);
}

/**
 * Helper function for making click handlers (for use in NSButton.setAction).
 */
NibUI.prototype.attachTargetAndAction = function(view, fn) {
  if (!this._clickActionNames) {
    this._clickActionNames = {};
  }

  var clickActionName;
  while (true) {
    clickActionName = 'zzzTempClickAction' + _randomId();
    if (!(clickActionName in this._clickActionNames)) {
      break;
    }
  }

  this._clickActionNames[clickActionName] = true;

  var selector = NSSelectorFromString(clickActionName + ':');
  this._cls.addInstanceMethodWithSelector_function_(
    selector,
    function() {
      fn();
    });

  view.setTarget(this._nibOwner);
  view.setAction(selector);
};

/**
 * Release all resources.
 */
NibUI.prototype.destroy = function() {
  this._bundle.unload();
};