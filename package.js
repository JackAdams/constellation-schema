Package.describe({
  name: 'constellation:schema',
  version: '0.3.4',
  summary: 'Schema generator plugin for Constellation',
  git: 'https://github.com/JackAdams/constellation-schema.git',
  documentation: 'README.md',
  debugOnly: true
});

Package.onUse(function(api) {
  api.versionsFrom('1.1');

  api.use(['templating','blaze','underscore','ejson','reactive-var','reactive-dict','tracker'], 'client');
  api.use('constellation:console@1.2.1', 'client');
  api.use('babrahams:editable-json@0.6.0', 'client');
  api.use('juliancwirko:s-alert@2.4.1', 'client');

  api.addFiles('schema.css','client');
  api.addFiles('schema.html','client');
  api.addFiles('schema.js','client');
  
  api.imply('constellation:console');
});

Package.onTest(function(api) {
  api.use('tinytest');
});
