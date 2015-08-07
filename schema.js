// Hook in to constellation UI

var API = Package["constellation:console"].API;
var Constellation = Package["constellation:console"].Constellation;
    
API.addTab({
  name: 'Schema',
  menuContentTemplate: 'Constellation_schema_menu',
  mainContentTemplate: 'Constellation_schema_main'
});

SchemaDict = new ReactiveDict('constellation-schema');
var SchemaDep = new Tracker.Dependency;

var keysThisGeneratorDoesForYou = ['type','label','optional','blackbox'];

sAlert.config({
	effect: '',
	position: 'top-left',
	timeout: 'none',
	html: true,
	onRouteClose: true,
	stack: true,
	offset: 0
});

// Startup - retrieve the existing schema we've been working on from localStorage
Meteor.startup(function () {
  _.each(API.getCollections(), function (collectionName) {
	SchemaDict.set(collectionName, getFromLocalStorage(collectionName));
  });
  if (!localStorage.Constellation_schema_collection) {
	localStorage.Constellation_schema_collection = API.getCollections()[0] || null;  
  }
  // We have no way of knowing that sAlert has been rendered already
  // This will cause double alerts for apps with sAlert already rendered
  Blaze.render(Template['sAlert'], document.body);
});

Template.sAlertContent.events({
  'click .Constellation_schema_restore_field' : function (evt, tmpl) {
	var elem = $(evt.target);
	var fieldName = elem.attr('data-fieldName');
	var fieldData = elem.attr('data-fieldData');
	if (fieldName && fieldData) {
	  var collection = localStorage.Constellation_schema_collection;
	  var schema = SchemaDict.get(collection);
	  schema[fieldName] = _.extend(JSON.parse(fieldData.replace(/'/g,'"')), {_restored: true});
	  SchemaDict.set(collection, schema);
      saveToLocalStorage(collection, schema);
      SchemaDep.changed();
	  tmpl.$('.s-alert-close').trigger('click');
	}
	else {
	  alert('Unable to restore field. Sorry!');	
	}
  }
});

Template.Constellation_schema_main.helpers({
  schema: function () {
	SchemaDep.depend();
	var collection = localStorage.Constellation_schema_collection;
    return SchemaDict.get(collection) || {};
  }
});

Template.Constellation_schema_menu.helpers({
  collections: function () {
    return API.getCollections();
  },
  selected: function () {
	return localStorage.Constellation_schema_collection === String(this);
  }
});

Template.Constellation_schema_menu.events({
  'click .Constellation_schema_generate' : function (evt, tmpl) {
    var collection = localStorage.Constellation_schema_collection;
	// Generate a schema for this collection and output it to the main panel
	newSchema = generateSchema(collection)
	SchemaDict.set(collection, newSchema);
	SchemaDep.changed();
    saveToLocalStorage(collection, newSchema);
  },
  'click .Constellation_schema_print' : function (evt, tmpl) {
    var collection = localStorage.Constellation_schema_collection;
	// Generate a schema for this collection and output it to an alert
	var customKeys = _.reduce(SchemaDict.get(collection), function (memo, scheme) {
	  return memo.concat(_.difference(_.keys(scheme), keysThisGeneratorDoesForYou));
	}, []);
	var fields = _.keys(SchemaDict.get(collection)).concat(customKeys); // concat-ing custom key values - the standard ones are concat-ed below
	var filteredSchema = {};
	_.each(SchemaDict.get(collection), function (val, key) {
	  delete val._restored;
	  filteredSchema[key] = val;
	});
	var schemaText = removeQuotesFromKeys(turnStringsToPrimitives(JSON.stringify(filteredSchema || {}, null, 2)), fields);
	sAlert.info('<textarea class="Constellation-schema-output">var ' + collection + 'Schema = new SimpleSchema(' + schemaText + ');\n\n' + firstToUpper(collection) + '.attachSchema(' + collection + 'Schema);</textarea>');
	Tracker.flush();
	$('.Constellation-schema-output').select();
  },
  'click .Constellation_schema_clear' : function () {
    var collection = localStorage.Constellation_schema_collection;
	if (!confirm('Any custom modifications you have made to this schema will be lost.\n\n\Are you sure?')) {
	  return;	
	}
	SchemaDict.set(collection, {});
	SchemaDep.changed();
    saveToLocalStorage(collection, {});
  },
  'change select' : function (evt, tmpl) {
	SchemaDep.changed();
	localStorage.Constellation_schema_collection = Blaze.getData(tmpl.$(evt.target).find(':selected')[0]); 
  }
});

EditableJSON.afterUpdate(function (store, action, JSONbefore, documentsUpdated) {
  var collection = localStorage.Constellation_schema_collection;
  SchemaDict.set(collection,this);
  SchemaDep.changed();
  saveToLocalStorage(collection, this);
},'constellation_schema');

var saveToLocalStorage = function (collection, schema) {
  localStorage['Constellation_schema.' + collection] = JSON.stringify(schema);	
}

var getFromLocalStorage = function (collection) {
  var existingValue = localStorage['Constellation_schema.' + collection];
  return existingValue && JSON.parse(existingValue) || {};
}

var generateSchema = function (collectionName) {
  var schemaData = {
	schema : SchemaDict.get(collectionName) || {},
	evidence: {}
  }
  var CollectionInstance = Constellation.Collection(collectionName);
  // This is heavy for big collections
  // Iterate over all fields in all document, scraping whatever information we can
  CollectionInstance.find().forEach(function (doc, index) {
	// We have the doc, now iterate over the fields, adding to or modifying the schema as it currently stands
	_.each(doc, function(value, field) {
	  if (field === '_id') {
		// Don't need a schema for this
		return;  
	  }
	  schemaData = modifySchema(schemaData, value, field, doc, index);
	  // This doc needs all existing fields or the ones it doesn't have must be optional fields
	  var optionalFields = _.difference(_.keys(schemaData.schema), _.without(_.keys(doc), '_id'));
	  _.each(optionalFields, function (fieldName) {
		// Check it's not a nested one
		if (fieldName.indexOf('.') > -1) {
		  // We have a cursory check of the first array element in each array field, if it exists
		  if (_.isUndefined(drillDown(doc, fieldName))) {
			schemaData.schema[fieldName].optional = true;
		  }
		}
		else {
		  schemaData.schema[fieldName].optional = true;
		}
	  });
	});
  });
  // Clean up
  // If, at the end, there are fields in our schema that we no longer have evidence for in the db, remove them
  var superfluousFields = _.difference(_.keys(schemaData.schema), _.keys(schemaData.evidence));
  _.each(superfluousFields, function (fieldName, index) {
	var existingRule = schemaData.schema[fieldName];
	if (!_.difference(_.keys(existingRule), keysThisGeneratorDoesForYou).length) {
	  // No custom keys from the user -- remove with impunity
	  // But also throw out an alert
	  if (!existingRule._restored) {
	    sAlert.warning('Field no longer found in database: <strong>' + fieldName + '</strong><br /><br /><pre>' + JSON.stringify(existingRule, null, 2) + '</pre><br />Removed from schema.<br /><br /><button class="Constellation_schema_restore_field" data-fieldName="' + fieldName + '" data-fieldData="' + JSON.stringify(existingRule).replace(/"/g,"'") + '">Restore field</button>');
	    delete schemaData.schema[fieldName];
	  }
	}
  });
  // Look for empty array types
  _.each(schemaData.schema, function (value, field) {
	if (value.type === '[]') {
	  schemaData.schema[field].type = '[String]';
	  sAlert.warning('Guessed that the array elements have type "String" for field: <strong>' + field + '</strong>');	
	}
  });
  return schemaData.schema;
}

var refenceValueLimit = 5;

var modifySchema = function (schemaData, value, field, doc, index) {
  
  var blackbox = false;
  var type = guessType(value);
  // console.log(field, value, type);
  
  if (!_.isUndefined(schemaData.schema[field]) || (schemaData.evidence[field] && schemaData.evidence[field].fieldSeenPreviously)) {
	var dontAddScheme = true;
	var existingDefinition = schemaData.schema[field];
	if (!schemaData.evidence[field]) {
	  // Pre-existing definition in our schema
	  schemaData.evidence[field] = {fieldSeenPreviously: true};
	}
	// This is not our first run through
	// Check that the type hasn't changed
	// If it has, alert the user -- we have an inconsistent set of data
	if (type === '[]') {
	  // Leave it be - we clean up these unknown quantities with a guess at the end - and alert the user
	}
	else if (!_.isUndefined(existingDefinition) && type !== existingDefinition.type) {
	  if (existingDefinition.type === '[]' && existingDefinition.type.charAt(0) === '[') {
		// Ah good ... so that's what type of elements are in this array
		// Make the change
		  schemaData.schema[field].type = type;
	  }
	  else {
	    // Retain the first type, but alert the user to the problem of mismatched types
		var regex = new RegExp('"' + field + '":', 'g');
		var highlightedDoc = JSON.stringify(doc).replace(regex, '<strong>"' + field + '":</strong>');
	    sAlert.error('Type mismatch found in db.<br /><br /><pre>' + highlightedDoc + '</pre><br />has a field "' + field + '" with type <strong>' + type + '</strong><br /><br />We were expecting type to be: <strong>' + ((existingDefinition.type === '[]') ? 'an array (element type unknown)' : existingDefinition.type) + '</strong>' + ((_.isUndefined(existingDefinition.type)) ? ' Check the <strong>' + field + '</strong> field in your schema - the "type" key is missing!' : ''));
	  }
	}
	if (type === 'Object') {
	  // Check for black-box-i-ness
	  // Run it against any reference values looking for a matching key
	  // If they don't have the same keys, they're probably black-box-y type objects and we don't want to list all their keys separately
	  if (schemaData.evidence[field] && schemaData.evidence[field].referenceValue) {
		var blackbox = !_.intersection(_.keys(value), _.keys(schemaData.evidence[field].referenceValue)).length;
		if (blackbox) {
		  // We have a clean up job on our hands
		  // Remove nested values
		  _.each(schemaData.evidence[field].nestedFields || [], function (fieldToRemove) {
            delete schemaData.schema[fieldToRemove]; 
		  });
		  dontAddScheme = false;
		}
	  }
	}
  }
  
  // Here's where we actually try to add new fields to the scheme
  
  if (!dontAddScheme || (type === 'Object' || type.charAt(0) === '[')) {
    var optional = false;
	// Check for optionalness by seeing if the state of existence is different from before
	if (_.isUndefined(schemaData.evidence[field])) {
	  schemaData.evidence[field] = {};
	}
	if (!schemaData.evidence[field].fieldSeenPreviously) {
	  // This is the first time we've seen this field
	  // Is it the first doc we've checked?
	  if (index) {
		// This wasn't in any previous docs
		optional = true;
	  }
	  schemaData.evidence[field].fieldSeenPreviously = true;
	}
	// For objects and arrays, we'll recurse in until we hit other types of of primitives
	if (type.charAt(0) === '[') { // It's an array!
	  var recursed = false;
	  var reference = type === '[Object]' && value.length && _.keys(_.last(value));
	  if (!reference || !_.find(_.initial(value), function (obj) { var keys = _.keys(obj); return !(_.intersection(reference, keys).length === keys.length && keys.length === reference.length)})) {
		_.each(value, function (v, i) {
		  var elementType = guessType(v);
		  if (elementType === 'Object' || elementType.charAt(0) === '[') {
			// Recurse
			modifySchema(schemaData, v, field + '.$', doc, index);
			recursed = true;
		  }
		});
		if (recursed) {
		  return schemaData;
		}
	  }
	  if (dontAddScheme) {
        return schemaData; 
	  }
	}
	else if (type === 'Object') {
	  if (!(blackbox || (schemaData.schema[field] && schemaData.schema[field].blackbox))) {
		if (!schemaData.evidence[field]) {
		  schemaData.evidence[field] = {};
		}
		schemaData.evidence[field].referenceValue = value;
		schemaData.evidence[field].nestedFields = [];
	    _.each(value, function (v, k) {
		  // We do allow this on the first run, giving the benefit of the doubt but we store the fields and their values in case we later discover this should be a black box
		  schemaData.evidence[field].nestedFields.push(field + '.' + k);
	      modifySchema(schemaData, v, field + '.' + k, doc, index);
	    });
	    return schemaData; // schemaData gets returned unchanged -- the child nodes will add dot delimited fields to it and its schema will be implied by SimpleSchema
	  }
	  if (dontAddScheme) {
        return schemaData; 
	  }
	}
	// We're at the end of tree (or as deeply nested as possible, depending on how you think of it)
	// Go ahead and add the field
	schemaData.schema[field] = {
	  type: type,
	  label: splitSnakeAndCamelCasingAndDelimiters(firstToUpper(field))
	}
	if (blackbox) {
	  schemaData.schema[field].blackbox = true;
	}
	if (optional) {
	  schemaData.schema[field].optional = true;	
	}
  }
  // Here is where we could keep a running max/min total if we wanted to, but this might be more trouble than its worth
  
  return schemaData;
}

var guessType = function (value) {
  var type = Constellation.guessType(value);
  if (type === 'array') {
	return contents = (value[0]) ? '[' + firstToUpper(guessType(value[0])) + ']' : '[]';
  }
  return (type === "undefined" || type === "null") ? type : firstToUpper(type);
}

var firstToUpper = function (text) {
  return text.charAt(0).toUpperCase() + text.substr(1);	
}

var primitives = {
  'Object': Object,
  'Array': Array,
  'String': String,
  'Date': Date,
  'Number': Number,
  'Boolean': Boolean,
  'null': null,
  'undefined': undefined
};

var turnStringsToPrimitives = function (text) {
  
  return _.reduce(_.keys(primitives), function (memo, primitive) {
	var regex = new RegExp('"type": "' + primitive + '"', "g");
	var arrayRegex = new RegExp('"\\[' + primitive + '\\]"', "g");
	return memo.replace(regex, '"type": ' + primitive).replace(arrayRegex, '[' + primitive + ']');
  }, text);
  
}

var removeQuotesFromKeys = function (text, fields) {
  return _.reduce(keysThisGeneratorDoesForYou.concat(fields), function (memo, key) {
	regex = new RegExp('"' + key + '": ', 'g');
	return (key.indexOf('.') > -1) ? memo : memo.replace(regex, key + ': ');
  }, text);
}

var splitSnakeAndCamelCasingAndDelimiters = function (text) {
  text = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  text = text.replace(/_/g, ' ');
  text = text.replace(/\.|[\.$]/g, ' ');
  text = text.replace(/\s+/g, ' ');
  return text;
}

var drillDown = function (obj, key) {
  var pieces = key.split('.');
  if (pieces.length > 1) {
    // Check if its an array
	if (pieces[1] === '$') {
	  // Always go for the first element
	  var arrElem = obj[pieces[0]] && obj[pieces[0]][0] || {};
	  pieces.shift();
	  pieces.shift();
	  return drillDown(arrElem,pieces.join('.'));
	}
    var newObj = obj ? obj[pieces[0]] : {};
    pieces.shift();
    return drillDown(newObj,pieces.join('.'));
  }
  else {
    if (obj) {
      return obj[key];
    }
    else {
      return; // undefined    
    }    
  }
}

/*var obj = {
  roles:[
    {name:'leader'},
    {name:'admin'}
  ]
};
console.log(drillDown(obj, 'roles.$.name')); // Should return 'leader'*/