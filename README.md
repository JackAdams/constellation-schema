SimpleSchema generator plugin for [Constellation](https://atmospherejs.com/babrahams/constellation) (an extensible dev console for Meteor).

`meteor add constellation:schema`

For speeding along the retrofitting of an app with schema, or for getting schema by starting with visual designs of your document structures.

This is designed so that pressing the "Generate" button after making custom updates to the schema or changes to your collections shouldn't hurt, but only help. If that's not the case open an issue on Github.

This keeps a working copy of your schemas in `localStorage`, so `localStorage.clear()` will delete them all. Once you've got a schema you're moderately happy with, cut and paste it into your code using the "Copy" button.