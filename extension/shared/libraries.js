// Deliberately curated: identifiers, never downloaded executable detection rules.
export const LIBRARIES = [
  { id: 'jquery', name: 'jQuery', npm: 'jquery', retire: 'jquery', cdn: ['jquery'], globals: [['jQuery','fn','jquery'], ['$','fn','jquery'], ['$j','fn','jquery'], ['$jq','fn','jquery']] },
  { id: 'angularjs', name: 'AngularJS', npm: 'angular', retire: 'angularjs', cdn: ['angular.js','angular'], globals: [['angular','version','full']] },
  { id: 'react', name: 'React', npm: 'react', retire: 'react', cdn: ['react'], globals: [['React','version']] },
  { id: 'react-dom', name: 'React DOM', npm: 'react-dom', retire: 'react-dom', cdn: ['react-dom'], globals: [['ReactDOM','version']] },
  { id: 'vue', name: 'Vue', npm: 'vue', retire: 'vue', cdn: ['vue'], globals: [['Vue','version']] },
  { id: 'lodash', name: 'Lodash', npm: 'lodash', retire: 'lodash', cdn: ['lodash.js','lodash'], globals: [] },
  { id: 'underscore', name: 'Underscore', npm: 'underscore', retire: 'underscore.js', cdn: ['underscore.js','underscore'], globals: [] },
  { id: 'moment', name: 'Moment', npm: 'moment', retire: 'moment.js', cdn: ['moment.js','moment'], globals: [['moment','version']] },
  { id: 'bootstrap', name: 'Bootstrap', npm: 'bootstrap', retire: 'bootstrap', cdn: ['twitter-bootstrap','bootstrap'], globals: [['bootstrap','Tooltip','VERSION'], ['bootstrap','Modal','VERSION'], ['bootstrap','Alert','VERSION'], ['jQuery','fn','tooltip','Constructor','VERSION'], ['jQuery','fn','modal','Constructor','VERSION'], ['$','fn','tooltip','Constructor','VERSION']] },
  { id: 'backbone', name: 'Backbone', npm: 'backbone', retire: 'backbone.js', cdn: ['backbone.js','backbone'], globals: [['Backbone','VERSION']] },
  { id: 'handlebars', name: 'Handlebars', npm: 'handlebars', retire: 'handlebars', cdn: ['handlebars.js','handlebars'], globals: [['Handlebars','VERSION']] },
  { id: 'axios', name: 'Axios', npm: 'axios', retire: 'axios', cdn: ['axios'], globals: [['axios','VERSION']] },
  { id: 'd3', name: 'D3', npm: 'd3', retire: 'd3', cdn: ['d3'], globals: [['d3','version']] },
  { id: 'chartjs', name: 'Chart.js', npm: 'chart.js', retire: 'chart.js', cdn: ['Chart.js','chart.js'], globals: [['Chart','version']] },
  { id: 'dompurify', name: 'DOMPurify', npm: 'dompurify', retire: 'DOMPurify', cdn: ['dompurify'], globals: [['DOMPurify','version']] }
];
export const BY_ID = new Map(LIBRARIES.map(library => [library.id, library]));
