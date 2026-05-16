import assert from "node:assert/strict";
import { indexMarkdown } from "./src/indexer.js";
assert.deepEqual(indexMarkdown("# Intro\n## API\n## API"), [{level:1,title:"Intro",anchor:"intro"},{level:2,title:"API",anchor:"api"},{level:2,title:"API",anchor:"api-2"}]);
