import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/** Fictional presentation documents. Never an official claim form or a real signature. */
export async function createDemoBillPdf(input: {
  reference: string; passenger: string; memberId: string; driver: string;
  date: string; plate: string; pickup: string; dropoff: string; tripRate: number; mileRate: number; includeCharges?: boolean;
}) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`DEMO ${input.includeCharges?'trip report and bill':'signed trip report'} ${input.reference}`);
  pdf.setSubject('Fictional training record. Not for submission. Sample signatures only.');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const script = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const page = pdf.addPage([612, 792]);
  const ink = rgb(.09, .14, .19), teal = rgb(.02,.39,.39), muted = rgb(.35,.4,.45);
  const text = (value: string, x: number, y: number, size = 11, font = regular, color = ink) =>
    page.drawText(value, { x, y, size, font, color });
  page.drawRectangle({ x: 0, y: 714, width: 612, height: 78, color: ink });
  text('EVERGREEN TRANSPORT', 40, 754, 19, bold, rgb(1,1,1));
  text('DEMO / NOT FOR SUBMISSION', 40, 731, 12, bold, rgb(.35,.9,.84));
  text(input.includeCharges?'Signed trip report & sample bill':'Signed trip report', 40, 680, 21, bold);
  text(`Reference: ${input.reference}`, 40, 655);
  text(`Service date: ${input.date}`, 355, 655);
  const field = (label: string, value: string, x: number, y: number) => {
    text(label.toUpperCase(), x, y, 9, bold, muted); text(value, x, y-19, 11);
  };
  field('Passenger (fictional)', input.passenger, 40, 615);
  field('Sample member ID', input.memberId, 330, 615);
  field('Driver', input.driver, 40, 561);
  field('Vehicle', `Transport van - ${input.plate}`, 330, 561);
  field('Pickup', input.pickup, 40, 507);
  field('Destination', input.dropoff, 40, 458);
  page.drawRectangle({x:40,y:372,width:532,height:44,color:rgb(.92,.96,.96)});
  text('Journey completed', 52, 397, 12, bold, teal);
  text('08:30 pickup  /  09:00 drop-off  /  12 loaded miles', 52, 381, 10);
  if(input.includeCharges) {
  text('SAMPLE BILLING',40,343,10,bold,teal);
  const money=(n:number)=>`$${n.toFixed(2)}`;
  text('Ambulatory transport - 1 trip',40,320); text(money(input.tripRate),500,320);
  text(`Loaded mileage - 12 miles x ${money(input.mileRate)}`,40,297); text(money(12*input.mileRate),500,297);
  page.drawLine({start:{x:40,y:282},end:{x:572,y:282},thickness:1,color:muted});
  text('Total sample charge',40,258,13,bold); text(money(input.tripRate+12*input.mileRate),494,258,14,bold);
  text('Illustrative rates only. No claim sent and no money collected.',40,238,9,regular,muted);
  } else {
    text('SERVICE CONFIRMATION',40,343,10,bold,teal);
    text('Ambulatory passenger transport - one-way journey',40,318);
    text('Passenger assisted at pickup and destination.',40,293);
    text('Sample completion record for the driver and dispatch team.',40,268,10,regular,muted);
  }
  text(input.passenger,40,194,21,script,teal);
  text(input.driver,330,194,21,script,teal);
  page.drawLine({start:{x:40,y:182},end:{x:276,y:182},thickness:.6,color:muted});
  page.drawLine({start:{x:330,y:182},end:{x:572,y:182},thickness:.6,color:muted});
  text('Passenger - SAMPLE SIGNATURE',40,166,9,bold);
  text('Driver - SAMPLE SIGNATURE',330,166,9,bold);
  text('Typed fictional signatures for presentation only.',40,144,10,regular,muted);
  page.drawRectangle({x:40,y:57,width:532,height:59,color:rgb(.98,.94,.9)});
  text('TRAINING RECORD ONLY',52,96,10,bold);
  text('Not an invoice, proof of service, payment receipt, or payer submission.',52,79,10);
  text('All people, journeys, member IDs and signatures in this document are fictional.',40,36,9,regular,muted);
  return pdf.save();
}
