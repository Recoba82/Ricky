const fs = require('fs');
const { Workbook } = require('exceljs');

async function main() {
  const dati = JSON.parse(fs.readFileSync('societa_sportive.json', 'utf8'));
  const wb = new Workbook();
  const ws = wb.addWorksheet('Società Sportive');

  ws.columns = [
    { header: 'Nome', key: 'nome', width: 40 },
    { header: 'Provincia', key: 'provincia', width: 15 },
    { header: 'Campionato', key: 'campionato', width: 60 },
    { header: 'Link', key: 'link', width: 60 },
  ];

  dati.forEach(s => ws.addRow({
    nome: s.nome || (s.celle && s.celle[0]) || '',
    provincia: s.provincia || '',
    campionato: s.campionato || '',
    link: s.link || '',
  }));

  await wb.xlsx.writeFile('societa_sportive.xlsx');
  console.log(`Fatto! ${dati.length} società → societa_sportive.xlsx`);
}

main();