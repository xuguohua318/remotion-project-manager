const fs = require('node:fs');
const path = require('node:path');
const Package = require('grunt-nuget-pack/lib/Package');

const [nuspecPath, appDirectory, outputDirectory] = process.argv.slice(2);
if (!nuspecPath || !appDirectory || !outputDirectory) {
  throw new Error('Usage: pack-nupkg.cjs <nuspec> <app-directory> <output-directory>');
}

const xml = fs.readFileSync(nuspecPath, 'utf8');
const decodeXml = (value) => value
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"')
  .replaceAll('&apos;', "'")
  .replaceAll('&amp;', '&');
const value = (tag, fallback = '') => {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? decodeXml(match[1].trim()) : fallback;
};

const metadata = {
  id: value('id'),
  version: value('version'),
  authors: value('authors', 'Remotion Project Manager'),
  owners: value('owners') || undefined,
  title: value('title') || undefined,
  description: value('description', 'Remotion Project Manager desktop application'),
  iconUrl: value('iconUrl') || undefined,
  copyright: value('copyright') || undefined,
  requireLicenseAcceptance: false,
};
for (const key of Object.keys(metadata)) {
  if (metadata[key] === undefined) delete metadata[key];
}

const destination = path.join(outputDirectory, `${metadata.id}.${metadata.version}.nupkg`);
const pkg = new Package(metadata);
const extensionlessFiles = [];
const collectExtensionless = (folder) => {
  for (const entry of fs.readdirSync(folder, {withFileTypes: true})) {
    const absolute = path.join(folder, entry.name);
    if (entry.isDirectory()) collectExtensionless(absolute);
    else if (entry.isFile() && path.extname(entry.name) === '') extensionlessFiles.push(absolute);
  }
};
collectExtensionless(appDirectory);
pkg.addExcludes(extensionlessFiles);
pkg.addFile(appDirectory, 'lib/net45');
pkg.saveAs(destination, (error) => {
  if (error) throw error;
  console.log(destination);
});
