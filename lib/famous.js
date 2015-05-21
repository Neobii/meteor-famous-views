/* Extend Meteor Template framework for .famousEvents() */
Template.prototype.famousEvents = function (eventMap) {
  var template = this;
  template.__famousEventMaps = (template.__famousEventMaps || []);
  template.__famousEventMaps.push(eventMap);
};

function setupEvents(fview, template) {
  if (template.__famousEventMaps) {
    var target = fview.surface || fview.view;
    _.each(template.__famousEventMaps, function(eventMap) {
      for (var k in eventMap) {
        target.on(k, (function(k) {
          return function(/* arguments */) {
            Array.prototype.push.call(arguments, fview);
            eventMap[k].apply(
              Blaze.getData(fview.renderedBlazeView), arguments);
          };
        })(k)); // jshint ignore:line
      }
    });
  }
}

// Used by famousEach too
parentViewName = function(blazeView) {
  while (blazeView &&
      (blazeView.name == "with" || blazeView.name == "(contentBlock)"))
    blazeView = blazeView.parentView;
  return blazeView ? blazeView.name : '(root)';
};

parentTemplateName = function(blazeView) {
  while (blazeView &&
      !blazeView.name.match(/^Template/) && !blazeView.name.match(/^body_content/))
    blazeView = blazeView.parentView;
  return blazeView ? blazeView.name : '(none)';
};

function getHelperFunc(view, name) {
  var helper;
  while ((view = view.parentView) !== null && !helper) {
    helper = view.template && view.template.__helpers.get(name);
  }
  return helper;
}

function famousCreated() {
  var blazeView = this.view;
  var famousViewName = blazeView.name ? blazeView.name.substr(7) : "";

  // don't re-use parent's data/attributes, don't mutate data object
  var inNewDataContext = blazeView.parentView && blazeView.parentView.__isTemplateWith;
  var data = inNewDataContext ? _.clone(this.data) : {};

  // deprecate
  if (!data.view && famousViewName === "")
    data.view = 'SequentialLayout';
  if (!data.view) data.view = famousViewName;
  else if (!famousViewName) {
    famousViewName = data.view;
    blazeView.viewName = 'Famous.' + famousViewName;
  }

  // Deprecated 2014-08-17
  if (data.size && _.isString(data.size) && data.size.substr(0,1) != '[')
    throw new Error('[famous-views] size="' + data.size + '" is deprecated, ' +
      'please use size="['+ data.size + ']" instead');

  var onRender;
  if (data._onRender) {
    onRender = getHelperFunc(blazeView, data._onRender);
    if (!onRender)
      log.error("No such helper for _onRender: " + data._onRender);
    delete data._onRender;
  }

  // See attribute parsing notes in README
  var options = handleOptions(data);

  // These require special handling (but should still be moved elsewhere)
  if (options.translate) {
    options.transform =
      Transform.translate.apply(null, options.translate);
    delete options.translate;
  }
  // any other transforms added here later must act on existing transform matrix

  var fview = blazeView.fview = new MeteorFamousView(blazeView, options);

  var pViewName = parentViewName(blazeView.parentView);
  var pTplName = parentTemplateName(blazeView.parentView);
  log.debug('New ' + famousViewName + " (#" + fview.id + ')' +
    (data.template ?
      ', content from "' + data.template + '"' :
      ', content from inline block') +
    ' (parent: ' + pViewName +
    (pViewName == pTplName ? '' : ', template: ' + pTplName) + ')');

  /*
  if (FView.viewOptions[data.view]
      && FView.viewOptions[data.view].childUiHooks) {
    // if childUiHooks specified, store them here too
    fview.childUiHooks = FView.viewOptions[data.view].childUiHooks;
  } else if (fview.parent.childUiHooks) {
    if (data.view == 'Surface') {
      fview.uiHooks = fview.parent.childUiHooks;
    } else {
      // Track descedents
    }
    console.log('child ' + data.view);
  }
  */

  var view, node, notReallyAView=false /* TODO :) */;

  // currently modifiers come via 'view' arg, for now (and Surface)
  if (data.view /* != 'Surface' */) {

    var registerable = FView._registerables[data.view];
    if (!registerable)
      throw new Error('Wanted view/modifier "' + data.view + '" but it ' +
        'doesn\'t exists.  Try FView.registerView/Modifier("'+ data.view +
        '", etc)');

    fview['_' + registerable.type] = registerable;        // fview._view
    node = registerable.create.call(fview, options);      // fview.node
    fview[registerable.type] = node;                      // fview.view

    if (node.sequenceFrom) {
      fview.sequence = new sequencer();
      node.sequenceFrom(fview.sequence._sequence);
    }

  }

  // If no modifier used, default to Modifier if origin/translate/etc used
  if (!data.modifier && !fview.modifier &&
      (data.origin || data.translate || data.transform ||
      (data.size && !node.size)))
    data.modifier = 'Modifier';

  // Allow us to prepend a modifier in a single template call
  if (data.modifier) {

    fview._modifier = FView._registerables[data.modifier];
    fview.modifier = fview._modifier.create.call(fview, options);

    if (node) {
      fview.setNode(fview.modifier).add(node);
      fview.view = node;
    } else
      fview.setNode(fview.modifier);

    if (fview._modifier.postRender)
      fview._modifier.postRender();

  } else if (node) {

    fview.setNode(node);

  }

  // could do pipe=1 in template helper?
  if (fview.parent.pipeChildrenTo)
    fview.pipeChildrenTo = fview.parent.pipeChildrenTo;

  // think about what else this needs  XXX better name, documentation
  if (fview._view && fview._view.famousCreatedPost)
    fview._view.famousCreatedPost.call(fview);

  // Render contents (and children)
  var newBlazeView, template, scopedView;
  if (blazeView.templateContentBlock) {
    if (data.template)
      throw new Error("A block helper {{#View}} cannot also specify template=X");
    // Called like {{#famous}}inlineContents{{/famous}}
    template = blazeView.templateContentBlock;
  } else if (data.template) {
    template = Template[data.template];
    if (!template)
      throw new Error('Famous called with template="' + data.template +
        '" but no such template exists');
    fview.template = template;
  } else {
    // Called with inclusion operator but not template {{>famous}}
    throw new Error("No template='' specified");
  }

  // Avoid Blaze running rendered() before it's actually on the DOM
  // Delete must happen before Blaze.render() called.
  if (data.view == 'Surface' && template.rendered) {
    template.onDocumentDom = template.rendered;
    delete template.rendered;
  }

  newBlazeView = template.constructView();
  setupEvents(fview, template);

  if (inNewDataContext) {
    scopedView = Blaze._TemplateWith(
      data.data || Blaze._parentData(1) && Blaze._parentData(1, true) || {},
      function() { return newBlazeView; }
    );
  }
  fview.renderedBlazeView = newBlazeView;

  if (data.view === 'Surface') {

    // in views/Surface.js; materialization happens via Blaze.render()
    fview.surfaceBlazeView = fview.renderedBlazeView;
    templateSurface(fview, scopedView || newBlazeView, blazeView, options,
      data.template ||
        parentTemplateName(blazeView.parentView).substr(9) + '_inline');

  } else {

    /*
     * It looks like this may be unavoidable.  Rendered callbacks down
     * the tree don't fire correctly if we decouple from the DOM, seems
     * various Tracker code relies on it.
     */
    var unusedDiv = document.createElement('DIV');
    Blaze.render(scopedView || newBlazeView, unusedDiv, null, blazeView);

    /*
     * As per above, below doesn't work properly.  But leaving it around
     * in case we find it's salvageable
     */

    //materializeView(scopedView || newBlazeView, blazeView);
    /*
     * Currently, we run this before we're added to the Render Tree, to
     * allow the rendered() callback to move us off screen before entrance,
     * etc.  In future, might be better to specify original position as
     * attributes, and then just do the animation in callback after we're
     * added to the tree
     */
    //if (template.rendered) {
    //  template.rendered.call(newBlazeView._templateInstance);
    //}
  }

  // XXX name, documentation
  // after render, templateSurface, etc
  if (fview._view && fview._view.postRender)
    fview._view.postRender.call(fview);

  /*
   * This is the final step where the fview is added to Famous Render Tree
   * By deferring the actual add we can prevent flicker from various causes
   */

  var parent = fview.parent;
  Engine.defer(function() {
    /*
     * Blaze allows for situations where templates may be created and destroyed,
     * without being rendered.  We should accomodate this better by not
     * rendering unnecessarily, but in the meantime, let's make sure at least
     * that we don't crash.  TODO
     *
     * E.g. subscription + cursor with sort+limit
     */
    if (fview.isDestroyed)
      return;

    if (parent._view && parent._view.add)
      // views can explicitly handle how their children should be added
      parent._view.add.call(parent, fview, options);
    else if (parent.sequence)
      // 'sequence' can be an array, sequencer or childSequencer, it doesn't matter
      parent.sequence.push(fview);
    else if (!parent.node || (parent.node._object && parent.node._object.isDestroyed))
      // compView->compView.  long part above is temp hack for template rerender #2010
      parent.setNode(fview);
    else
      // default case, just use the add method
      parent.node.add(fview);

    // XXX another undocumented... consolidate names and document
    // e.g. famousCreatedPost; and is modifier.postRender documented?
    if (fview._view && fview._view.onRenderTree)
      fview._view.onRenderTree.call(fview);

    if (onRender) {
      onRender.call(fview.blazeView);
    }
  });
}

/*
 * Here we emulate the flow of Blaze._materializeView but avoid all
 * DOM stuff, since we don't need it
 */
var materializeView = function(view, parentView) {
  Blaze._createView(view, parentView);

  var lastHtmljs;
  Tracker.nonreactive(function() {
    view.autorun(function doFamousRender(c) {
      view.renderCount++;
      view._isInRender = true;
      var htmljs = view._render(); // <-- only place invalidation happens
      view._isInRender = false;

      Tracker.nonreactive(function doFamousMaterialize() {
        var materializer = new Blaze._DOMMaterializer({parentView: view});
        materializer.visit(htmljs, []);
        if (c.firstRun || !Blaze._isContentEqual(lastHtmljs, htmljs)) {
          if (c.firstRun)
            view.isRendered = true;
          // handle this elsewhere
          // Blaze._fireCallbacks(view, 'rendered');
        }
      });
      lastHtmljs = htmljs;
    });
  });
};

/*
 * This is called by Blaze when the View/Template is destroyed,
 * e.g. {{#if 0}}{{#Scrollview}}{{/if}}.  When this happens we need to:
 *
 * 1) Destroy children (Blaze won't do it since it's not in the DOM),
 *    and any "eaches" that may have been added from a famousEach.
 * 2) Call fview.destroy() which handles cleanup w.r.t. famous,
 *    which lives in meteorFamousView.js.
 *
 * It's possible we want to have the "template" destroyed but not the
 * fview in the render tree to do a graceful exit animation, etc.
 */
function famousDestroyed() {
  this.view.fview.destroy(true);
}

// Keep this at the bottom; Firefox doesn't do function hoisting

FView.famousView = new Template(
  'famous',           // viewName: "famous"
  function() {        // Blaze.View "renderFunc"
    var blazeView = this;
    var data = Blaze.getData(blazeView);
    var tpl = blazeView._templateInstance;
    var fview = blazeView.fview;

    var changed = {};
    var orig = {};
    for (var key in data) {
      var value = data[key];
      if (typeof value === "string")
        value = optionString(value, key, blazeView);
      if (value === '__FVIEW::SKIP__')
        continue;
      if (!EJSON.equals(value, tpl.data[key]) || !blazeView.hasRendered) {
        orig[key] = blazeView.hasRendered ? tpl.data[key] : null;
        changed[key] = tpl.data[key] = value;
      }
    }

    /*
     * Think about:
     *
     * 1) Should the function get the old value or all old data too?
     * 2) Should the function get all the new data, but translated?
     *
     */

    _.each(['modifier', 'view'], function(node) {

      // If the fview has a modifier or view
      var what = '_' + node;
      if (fview[what]) {
        if (fview[what].attrUpdate) {
          // If that mod/view wants to finely handle reactive updates
          for (var key in changed)
            fview[what].attrUpdate.call(fview,
              key, changed[key], orig[key], tpl.data, !blazeView.hasRendered);
        } else if (fview[node].setOptions && blazeView.hasRendered) {
          // Otherwise if it has a setOptions
          fview[node].setOptions(tpl.data);
        }
      }

    });

//    console.log(view);
    blazeView.hasRendered = true;
    return null;
  }
);

Blaze.registerHelper('famous', FView.famousView);
FView.famousView.created = famousCreated;
FView.famousView.destroyed = famousDestroyed;
