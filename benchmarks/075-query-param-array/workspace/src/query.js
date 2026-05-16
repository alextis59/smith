export function toQuery(input){return Object.entries(input).map(([k,v])=>k+"="+v).join("&");}
