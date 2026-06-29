function buildMessage(row, template) {
  const {
    namesField = 'NAMES',
    licenseField = 'LICENSE NUMBERS',
    ussdCode = '*790*0#',
    startDate = 'Mon. 13th Jul.',
    endDate = 'Fri. 7th Aug. 2026',
    enquiriesPhone = '0209229100',
    programName = 'Annual Pharmacy Council OTCMS Training Programme'
  } = template || {};

  const name = (row[namesField] || '').trim();
  const license = (row[licenseField] || '').trim();

  return `${name} OTCMS (Licence No. ${license}), Kindly register for the ${programName} by dialling ${ussdCode}. Training runs from ${startDate} to ${endDate}. For enquiries, call ${enquiriesPhone}`;
}

module.exports = { buildMessage };
