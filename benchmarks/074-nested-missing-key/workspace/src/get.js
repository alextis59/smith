export function get(obj,path){return path.split(".").reduce((o,k)=>o[k],obj);}
