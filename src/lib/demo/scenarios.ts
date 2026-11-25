import type { Category, Severity } from "@/lib/types";

/**
 * Fictional scenarios. Every record is invented for interface demonstration and
 * is carried into the UI with isDemo=true. Locations are real LGAs so that the
 * map can place LGA-level fallback markers from authoritative boundaries.
 */
export interface DemoScenario {
  stateId: string | null;
  lga: string | null;
  category: Category;
  subcategory: string;
  severity: Severity;
  title: string;
  summary: string;
  sourceCount?: number;
  official?: boolean;
  disputed?: boolean;
  retracted?: boolean;
  unassessed?: boolean;
  corroborated?: boolean;
  hoursAgo?: number;
}

/**
 * Ages in hours before the fixed demo reference time. All primary events fall
 * within 30 days so every state has visible intelligence in the default view.
 */
const DEMO_AGES = [
  3, 7, 12, 18, 25, 34, 45, 58, 72, 88, 105, 124, 146, 170, 196, 224, 254, 286, 320, 356, 394, 434,
  476, 520, 566, 614, 650, 2, 9, 21, 36, 54, 75, 99, 126, 156, 189, 225, 264, 306, 351, 399, 450,
  504, 561, 621, 655, 5, 15, 28, 44, 63, 85, 110, 138, 169, 203, 240, 280, 323, 369, 418, 470, 525,
  582, 640, 4, 17, 31, 49, 69, 92, 118, 148, 181, 217, 256, 298, 343, 391, 442, 496, 553, 612,
];

export function demoAgeHours(index: number): number {
  return DEMO_AGES[index % DEMO_AGES.length] ?? 120;
}

export const PRIMARY_SCENARIOS: readonly DemoScenario[] = [
  {
    stateId: "NG-AB",
    lga: "Aba North",
    category: "economy",
    subcategory: "business_activity",
    severity: 2,
    title: "Aba garment cluster outlines export expansion proposal",
    summary:
      "A demo business forum in Aba North has discussed a proposal to expand garment exports through a shared quality-testing facility. No investment decision or construction date has been reported.",
    sourceCount: 2,
  },
  {
    stateId: "NG-AD",
    lga: "Yola North",
    category: "security",
    subcategory: "armed_robbery",
    severity: 3,
    title: "Security advisory issued after reported robbery on Yola ring road",
    summary:
      "A demo advisory describes a reported robbery affecting evening traffic on a ring road in Yola North. The report has not been independently confirmed and contains no casualty figures.",
    sourceCount: 1,
  },
  {
    stateId: "NG-AK",
    lga: "Uyo",
    category: "infrastructure",
    subcategory: "drainage",
    severity: 2,
    title: "Uyo drainage upgrade moves to procurement review",
    summary:
      "A demo procurement notice outlines a proposed drainage upgrade in Uyo. The notice is at an early stage; no contractor award, budget release or construction date has been announced.",
    sourceCount: 2,
  },
  {
    stateId: "NG-AN",
    lga: "Onitsha North",
    category: "economy",
    subcategory: "markets",
    severity: 3,
    title: "Onitsha traders seek clarity on market relocation timeline",
    summary:
      "Demo reports describe differing accounts of a proposed market relocation in Onitsha North. Trader representatives and a state desk are reported to disagree on the timeline and consultation process.",
    sourceCount: 2,
    disputed: true,
  },
  {
    stateId: "NG-BA",
    lga: "Bauchi",
    category: "health",
    subcategory: "preparedness",
    severity: 2,
    title: "Bauchi begins seasonal malaria preparedness review",
    summary:
      "A demo health desk reports the start of a seasonal malaria preparedness review in Bauchi. The exercise is planning-focused; no outbreak has been declared and no case figures are presented.",
    sourceCount: 2,
  },
  {
    stateId: "NG-BY",
    lga: "Southern Ijaw",
    category: "environment",
    subcategory: "flood_preparedness",
    severity: 4,
    title: "Flood readiness exercise under way in Southern Ijaw communities",
    summary:
      "A demo flood-readiness exercise is described in Southern Ijaw, including shelter checks and boat evacuation drills. This is a preparedness scenario, not a real emergency or a confirmed flood event.",
    sourceCount: 2,
  },
  {
    stateId: "NG-BE",
    lga: "Guma",
    category: "security",
    subcategory: "communal_tension",
    severity: 4,
    title: "Farmers report tension over grazing routes in Guma",
    summary:
      "A demo report describes renewed tension between farming communities over grazing routes in Guma. The account is attributed to community representatives and has not been independently verified.",
    sourceCount: 2,
  },
  {
    stateId: "NG-BO",
    lga: "Jere",
    category: "security",
    subcategory: "security_operation",
    severity: 3,
    title: "Security screening stepped up at Maiduguri–Jere checkpoint",
    summary:
      "A demo security desk reports additional screening at a checkpoint serving the Maiduguri–Jere axis. The scenario describes delays to movement; no incident, arrest or casualty is confirmed.",
    sourceCount: 2,
  },
  {
    stateId: "NG-CR",
    lga: "Calabar Municipal",
    category: "politics",
    subcategory: "legislature",
    severity: 1,
    title: "Cross River assembly opens hearing on budget transparency",
    summary:
      "A demo governance report describes a public hearing on budget transparency in Calabar Municipal. The hearing is at committee stage and no final resolution has been reported.",
    sourceCount: 1,
    unassessed: true,
  },
  {
    stateId: "NG-DE",
    lga: "Warri South",
    category: "environment",
    subcategory: "oil_spill_preparedness",
    severity: 3,
    title: "Oil spill response drill scheduled near Warri South shoreline",
    summary:
      "A demo environmental notice schedules a response drill near the Warri South shoreline. The scenario is a preparedness exercise and does not report a spill or confirm environmental damage.",
    sourceCount: 2,
  },
  {
    stateId: "NG-EB",
    lga: "Abakaliki",
    category: "infrastructure",
    subcategory: "roads",
    severity: 2,
    title: "Abakaliki ring road design review enters final stage",
    summary:
      "A demo infrastructure update says the design review for an Abakaliki ring road has reached its final stage. Procurement and construction timelines have not been announced.",
    sourceCount: 2,
  },
  {
    stateId: "NG-ED",
    lga: "Oredo",
    category: "health",
    subcategory: "health_services",
    severity: 2,
    title: "Edo health desk expands mobile screening schedule",
    summary:
      "A demo health desk outlines an expanded mobile screening schedule in Oredo. The record describes service planning and does not report an outbreak or a change in official health guidance.",
    sourceCount: 2,
  },
  {
    stateId: "NG-EK",
    lga: "Ado-Ekiti",
    category: "politics",
    subcategory: "local_government",
    severity: 1,
    title: "Ekiti council reform bill returns to committee",
    summary:
      "A demo governance report says a local government reform bill has returned to committee in Ado-Ekiti. No final vote or implementation date is reported.",
    sourceCount: 1,
  },
  {
    stateId: "NG-EN",
    lga: "Nsukka",
    category: "economy",
    subcategory: "agriculture",
    severity: 2,
    title: "Nsukka agro-processing cooperative seeks storage investment",
    summary:
      "A demo cooperative in Nsukka is seeking investment for shared storage. The report describes an early-stage proposal; no funding commitment or construction has been confirmed.",
    sourceCount: 2,
  },
  {
    stateId: "NG-FC",
    lga: "Municipal Area Council",
    category: "politics",
    subcategory: "public_administration",
    severity: 2,
    title: "FCT residents' forum reviews transport master plan",
    summary:
      "A demo residents' forum in the Municipal Area Council reviewed a draft transport plan. The record describes consultation, not an approved policy or a funded project.",
    sourceCount: 2,
  },
  {
    stateId: "NG-GO",
    lga: "Gombe",
    category: "health",
    subcategory: "vaccination",
    severity: 3,
    title: "Gombe launches measles vaccination coordination review",
    summary:
      "A demo health desk reports a coordination review for measles vaccination planning in Gombe. No outbreak is declared and no coverage figures are provided.",
    sourceCount: 2,
  },
  {
    stateId: "NG-IM",
    lga: "Oguta",
    category: "environment",
    subcategory: "flood_preparedness",
    severity: 4,
    title: "Flood warning exercise focuses on Oguta lake communities",
    summary:
      "A demo exercise simulates flood warnings for communities around Oguta lake. It is a preparedness scenario with no confirmed flooding, displacement or casualties.",
    sourceCount: 3,
    corroborated: true,
  },
  {
    stateId: "NG-JI",
    lga: "Hadejia",
    category: "environment",
    subcategory: "flood_preparedness",
    severity: 3,
    title: "Hadejia riverine communities begin flood preparedness drill",
    summary:
      "A demo preparedness drill is under way in riverine communities near Hadejia. The scenario describes early-warning checks and does not confirm a flood event.",
    sourceCount: 2,
  },
  {
    stateId: "NG-KD",
    lga: "Chikun",
    category: "security",
    subcategory: "security_operation",
    severity: 4,
    title: "Security operation reported along Kaduna–Chikun corridor",
    summary:
      "A demo security report describes an operation along the Kaduna–Chikun corridor. The scenario does not establish the actors, outcome or impact, and no casualty figures are presented.",
    sourceCount: 3,
    official: true,
  },
  {
    stateId: "NG-KN",
    lga: "Dala",
    category: "economy",
    subcategory: "markets",
    severity: 3,
    title: "Dala textile traders report rising input costs",
    summary:
      "A demo market report describes textile traders in Dala raising concerns about input costs. The record reflects reported trader accounts, not an official price index.",
    sourceCount: 2,
  },
  {
    stateId: "NG-KT",
    lga: "Daura",
    category: "security",
    subcategory: "community_policing",
    severity: 1,
    title: "Community policing forum held in Daura",
    summary:
      "A demo community policing forum was held in Daura. The record describes a coordination meeting and does not report an incident.",
    sourceCount: 1,
  },
  {
    stateId: "NG-KE",
    lga: "Birnin Kebbi",
    category: "economy",
    subcategory: "agro_processing",
    severity: 2,
    title: "Kebbi rice mill expansion enters feasibility stage",
    summary:
      "A demo agribusiness report says a rice mill expansion in Birnin Kebbi has entered feasibility review. No financing or construction commitment is reported.",
    sourceCount: 2,
  },
  {
    stateId: "NG-KO",
    lga: "Lokoja",
    category: "infrastructure",
    subcategory: "bridges",
    severity: 3,
    title: "Lokoja bridge maintenance window announced",
    summary:
      "A demo transport notice announces a maintenance window for a bridge near Lokoja. The scenario describes expected traffic disruption; the schedule may change.",
    sourceCount: 2,
  },
  {
    stateId: "NG-KW",
    lga: "Ilorin West",
    category: "politics",
    subcategory: "public_finance",
    severity: 1,
    title: "Kwara assembly reviews state enterprise reporting",
    summary:
      "A demo governance report describes a committee review of state enterprise reporting in Ilorin West. The originating demo source later retracted part of the account.",
    sourceCount: 2,
    retracted: true,
  },
  {
    stateId: "NG-LA",
    lga: "Ikeja",
    category: "infrastructure",
    subcategory: "transport",
    severity: 2,
    title: "Ikeja transport interchange study released for comment",
    summary:
      "A demo transport study for an Ikeja interchange has been released for public comment. The record does not confirm funding, approval or a construction start.",
    sourceCount: 3,
    corroborated: true,
  },
  {
    stateId: "NG-NA",
    lga: "Karu",
    category: "infrastructure",
    subcategory: "roads",
    severity: 3,
    title: "Karu commuter route upgrade begins consultation",
    summary:
      "A demo consultation has opened on an upgrade to a commuter route in Karu. No design, procurement or construction decision has been reported.",
    sourceCount: 1,
  },
  {
    stateId: "NG-NI",
    lga: "Shiroro",
    category: "security",
    subcategory: "security_advisory",
    severity: 4,
    title: "Security advisory issued for Shiroro riverine route",
    summary:
      "Demo reports describe a security advisory affecting a riverine route in Shiroro. Accounts differ on the scope of the advisory; no incident or casualty figure is independently confirmed.",
    sourceCount: 2,
    disputed: true,
  },
  {
    stateId: "NG-OG",
    lga: "Ado Odo/Ota",
    category: "economy",
    subcategory: "manufacturing",
    severity: 2,
    title: "Ota manufacturing park announces new tenant intake",
    summary:
      "A demo industrial park in Ado Odo/Ota has opened a tenant intake process. The report describes commercial interest, not confirmed new factories or jobs.",
    sourceCount: 2,
  },
  {
    stateId: "NG-ON",
    lga: "Ilaje",
    category: "environment",
    subcategory: "coastal_erosion",
    severity: 3,
    title: "Ilaje coastal erosion assessment gets new funding",
    summary:
      "A demo environmental programme has allocated funding for a coastal erosion assessment in Ilaje. The record describes assessment funding, not completed protection works.",
    sourceCount: 2,
  },
  {
    stateId: "NG-OS",
    lga: "Osogbo",
    category: "politics",
    subcategory: "culture",
    severity: 1,
    title: "Osogbo heritage corridor plan goes to public hearing",
    summary:
      "A demo public hearing has opened on a heritage corridor plan in Osogbo. The record describes consultation and makes no claim of an approved development.",
    sourceCount: 1,
  },
  {
    stateId: "NG-OY",
    lga: "Ibadan North",
    category: "health",
    subcategory: "primary_care",
    severity: 2,
    title: "Ibadan primary health centres begin outreach review",
    summary:
      "A demo health review covers outreach services at primary health centres in Ibadan North. No outbreak, service closure or official directive is reported.",
    sourceCount: 2,
  },
  {
    stateId: "NG-PL",
    lga: "Bokkos",
    category: "security",
    subcategory: "security_operation",
    severity: 4,
    title: "Security patrols reinforced around Bokkos markets",
    summary:
      "A demo security report describes reinforced patrols around markets in Bokkos. The scenario does not confirm an incident, arrest or casualty, and requires verification.",
    sourceCount: 2,
  },
  {
    stateId: "NG-RI",
    lga: "Obio/Akpor",
    category: "economy",
    subcategory: "sme_support",
    severity: 2,
    title: "Rivers SME support window opens in Obio/Akpor",
    summary:
      "A demo business support programme has opened an application window for SMEs in Obio/Akpor. The record describes a programme announcement, not approved awards.",
    sourceCount: 2,
  },
  {
    stateId: "NG-SO",
    lga: "Sokoto North",
    category: "health",
    subcategory: "nutrition",
    severity: 2,
    title: "Sokoto nutrition programme expands to new clinics",
    summary:
      "A demo nutrition programme is described as expanding to additional clinics in Sokoto North. No caseload figures or independent evaluation are provided.",
    sourceCount: 1,
  },
  {
    stateId: "NG-TA",
    lga: "Wukari",
    category: "security",
    subcategory: "civil_unrest",
    severity: 4,
    title: "Curfew review announced after Wukari disturbances",
    summary:
      "A demo official bulletin announces a review of movement restrictions following reported disturbances in Wukari. This is a fictional scenario and not a real public-order notice.",
    sourceCount: 3,
    official: true,
  },
  {
    stateId: "NG-YO",
    lga: null,
    category: "infrastructure",
    subcategory: "water",
    severity: 3,
    title: "Yobe water scheme rehabilitation advances",
    summary:
      "A demo infrastructure report says rehabilitation of a water scheme in Yobe has advanced to a new phase. The record does not identify a specific community or confirm completion.",
    sourceCount: 2,
  },
  {
    stateId: "NG-ZA",
    lga: "Anka",
    category: "security",
    subcategory: "security_operation",
    severity: 4,
    title: "Security operation reported in Anka local government",
    summary:
      "A demo security report describes an operation in Anka. The scenario does not establish the actors or outcome and contains no independently verified casualty figures.",
    sourceCount: 2,
  },
];

export const EXTRA_SCENARIOS: readonly DemoScenario[] = [
  {
    stateId: "NG-LA",
    lga: "Lagos Island",
    category: "economy",
    subcategory: "markets",
    severity: 2,
    title: "Lagos Island traders review new levy schedule",
    summary:
      "A demo market association in Lagos Island has reviewed a draft levy schedule. The record describes consultation and does not confirm an approved increase.",
    sourceCount: 2,
  },
  {
    stateId: "NG-LA",
    lga: "Ibeju Lekki",
    category: "infrastructure",
    subcategory: "roads",
    severity: 2,
    title: "Ibeju Lekki road corridor survey begins",
    summary:
      "A demo survey has begun along a road corridor in Ibeju Lekki. No construction contract or completion date is reported.",
    sourceCount: 2,
  },
  {
    stateId: "NG-LA",
    lga: "Ikorodu",
    category: "environment",
    subcategory: "drainage",
    severity: 3,
    title: "Ikorodu flood drainage inspection announced",
    summary:
      "A demo inspection of drainage channels in Ikorodu has been announced ahead of seasonal rains. The record is a preparedness notice, not a flood report.",
    sourceCount: 2,
  },
  {
    stateId: "NG-LA",
    lga: "Alimosho",
    category: "health",
    subcategory: "health_services",
    severity: 2,
    title: "Alimosho mobile clinic schedule expanded",
    summary:
      "A demo health desk says a mobile clinic schedule in Alimosho has been expanded. No patient numbers, funding details or independent evaluation are reported.",
    sourceCount: 2,
  },
  {
    stateId: "NG-LA",
    lga: "Lagos Mainland",
    category: "infrastructure",
    subcategory: "transport",
    severity: 2,
    title: "Lagos Mainland rail access study released",
    summary:
      "A demo transport study examines rail access around Lagos Mainland. The record describes a study, not an approved line, station or construction programme.",
    sourceCount: 2,
  },
  {
    stateId: "NG-FC",
    lga: "Bwari",
    category: "security",
    subcategory: "community_policing",
    severity: 3,
    title: "Patrol review announced for Bwari axis",
    summary:
      "A demo security coordination meeting reviewed patrol coverage around Bwari. No specific incident is confirmed in the record.",
    sourceCount: 2,
  },
  {
    stateId: "NG-FC",
    lga: "Gwagwalada",
    category: "infrastructure",
    subcategory: "transport",
    severity: 2,
    title: "Gwagwalada bus terminal upgrade enters design review",
    summary:
      "A demo transport notice says a bus terminal upgrade in Gwagwalada has entered design review. No procurement or construction date is announced.",
    sourceCount: 2,
  },
  {
    stateId: "NG-FC",
    lga: "Municipal Area Council",
    category: "economy",
    subcategory: "sme_support",
    severity: 1,
    title: "Abuja SME fair announced for municipal area",
    summary:
      "A demo SME fair has been announced in the Municipal Area Council. The record describes an event listing and does not imply investment commitments.",
    sourceCount: 1,
  },
  {
    stateId: "NG-KN",
    lga: "Kano Municipal",
    category: "politics",
    subcategory: "public_finance",
    severity: 1,
    title: "Kano Municipal council opens sanitation budget hearing",
    summary:
      "A demo council hearing in Kano Municipal covers a sanitation budget proposal. No final budget or procurement decision is reported.",
    sourceCount: 1,
  },
  {
    stateId: "NG-KN",
    lga: "Kano Municipal",
    category: "infrastructure",
    subcategory: "drainage",
    severity: 3,
    title: "Kano urban drainage works scheduled",
    summary:
      "A demo works notice schedules drainage maintenance in Kano Municipal. The record describes a plan and does not confirm completed work or contract award.",
    sourceCount: 2,
  },
  {
    stateId: "NG-KN",
    lga: "Nassarawa",
    category: "health",
    subcategory: "health_services",
    severity: 2,
    title: "Kano health workers begin outreach review",
    summary:
      "A demo health review covers outreach planning in Nassarawa, Kano. No official health alert or outbreak declaration is included.",
    sourceCount: 2,
  },
  {
    stateId: "NG-RI",
    lga: "Degema",
    category: "environment",
    subcategory: "flood_preparedness",
    severity: 4,
    title: "Degema creek communities begin flood drill",
    summary:
      "A demo flood drill is under way in creek communities in Degema. The scenario describes evacuation planning and does not confirm a real flood event.",
    sourceCount: 2,
  },
  {
    stateId: "NG-RI",
    lga: "Port-Harcourt",
    category: "security",
    subcategory: "community_policing",
    severity: 3,
    title: "Port Harcourt security meeting reviews waterfront patrols",
    summary:
      "A demo security meeting reviewed waterfront patrol coordination in Port Harcourt. No incident, arrest or operational outcome is confirmed.",
    sourceCount: 2,
  },
  {
    stateId: "NG-RI",
    lga: "Obio/Akpor",
    category: "infrastructure",
    subcategory: "roads",
    severity: 2,
    title: "Obio/Akpor feeder road repair enters procurement",
    summary:
      "A demo procurement notice covers feeder road repairs in Obio/Akpor. The record does not confirm a contractor or start date.",
    sourceCount: 2,
  },
  {
    stateId: "NG-KD",
    lga: "Kaduna North",
    category: "politics",
    subcategory: "public_administration",
    severity: 1,
    title: "Kaduna assembly reviews urban renewal report",
    summary:
      "A demo committee report on urban renewal was reviewed by the Kaduna assembly. No final decision or funding approval is reported.",
    sourceCount: 2,
  },
  {
    stateId: "NG-KD",
    lga: "Zaria",
    category: "economy",
    subcategory: "manufacturing",
    severity: 2,
    title: "Zaria textile cooperative opens shared facility",
    summary:
      "A demo textile cooperative in Zaria has opened a shared production facility. The record describes a cooperative announcement and does not verify output or employment figures.",
    sourceCount: 2,
  },
  {
    stateId: "NG-BO",
    lga: "Maiduguri",
    category: "health",
    subcategory: "health_services",
    severity: 2,
    title: "Maiduguri health centre expansion discussed",
    summary:
      "A demo planning meeting discussed expansion of a health centre in Maiduguri. No construction funding or opening date is confirmed.",
    sourceCount: 2,
  },
  {
    stateId: "NG-BO",
    lga: "Biu",
    category: "economy",
    subcategory: "agriculture",
    severity: 2,
    title: "Biu grain traders review storage plan",
    summary:
      "A demo traders' association in Biu has reviewed a shared grain storage proposal. No financing or construction commitment is reported.",
    sourceCount: 1,
  },
  {
    stateId: "NG-OY",
    lga: "Ibadan North",
    category: "economy",
    subcategory: "markets",
    severity: 2,
    title: "Ibadan traders outline digital payment pilot",
    summary:
      "A demo market association in Ibadan North has outlined a digital payment pilot. The record describes a proposal, not an operating system or verified transaction data.",
    sourceCount: 2,
  },
  {
    stateId: "NG-OY",
    lga: "Oyo East",
    category: "infrastructure",
    subcategory: "roads",
    severity: 2,
    title: "Oyo rural road survey begins",
    summary:
      "A demo survey has begun on a rural road in Oyo East. No construction contract or completion schedule is reported.",
    sourceCount: 1,
  },
  {
    stateId: "NG-AN",
    lga: "Onitsha South",
    category: "infrastructure",
    subcategory: "drainage",
    severity: 3,
    title: "Onitsha drainage maintenance scheduled",
    summary:
      "A demo maintenance notice schedules drainage work in Onitsha South. The record describes planned work and does not confirm completion.",
    sourceCount: 2,
  },
  {
    stateId: "NG-AN",
    lga: "Nnewi North",
    category: "economy",
    subcategory: "manufacturing",
    severity: 2,
    title: "Nnewi auto parts cluster reviews export standards",
    summary:
      "A demo industry cluster in Nnewi North reviewed export quality standards. No certification, contract or export volume is confirmed.",
    sourceCount: 2,
  },
  {
    stateId: "NG-IM",
    lga: "Owerri Municipal",
    category: "politics",
    subcategory: "public_finance",
    severity: 1,
    title: "Owerri municipal budget forum opens",
    summary:
      "A demo budget forum opened in Owerri Municipal. The record describes consultation and makes no claim of an approved budget.",
    sourceCount: 1,
  },
  {
    stateId: "NG-IM",
    lga: "Orlu",
    category: "security",
    subcategory: "crime",
    severity: 2,
    title: "Security alert issued after reported theft at Orlu market",
    summary:
      "A demo security alert describes a reported theft at a market in Orlu. No arrest or recovery is confirmed and no personal details are included.",
    sourceCount: 1,
  },
  {
    stateId: "NG-BE",
    lga: "Makurdi",
    category: "environment",
    subcategory: "flood_preparedness",
    severity: 3,
    title: "Benue flood response warehouse audit begins",
    summary:
      "A demo preparedness audit covers flood response warehouses in Makurdi. The exercise is not a flood report and no displacement figures are provided.",
    sourceCount: 2,
  },
  {
    stateId: "NG-BE",
    lga: "Gboko",
    category: "economy",
    subcategory: "agriculture",
    severity: 2,
    title: "Gboko agro dealers review storage costs",
    summary:
      "A demo dealers' meeting in Gboko reviewed storage and transport costs. The record reflects reported business concerns, not an official price index.",
    sourceCount: 2,
  },
  {
    stateId: "NG-PL",
    lga: "Jos North",
    category: "infrastructure",
    subcategory: "transport",
    severity: 2,
    title: "Jos terminal access road review announced",
    summary:
      "A demo transport review covers access roads around a terminal in Jos North. No construction or funding decision is reported.",
    sourceCount: 2,
  },
  {
    stateId: "NG-PL",
    lga: "Barkin Ladi",
    category: "health",
    subcategory: "primary_care",
    severity: 2,
    title: "Plateau mobile clinics extend highland schedule",
    summary:
      "A demo health desk says mobile clinics will extend their schedule in Barkin Ladi. The record does not include caseload or outcome data.",
    sourceCount: 2,
  },
  {
    stateId: "NG-DE",
    lga: "Warri South",
    category: "infrastructure",
    subcategory: "ports",
    severity: 3,
    title: "Warri port access road maintenance planned",
    summary:
      "A demo maintenance plan covers a port access road in Warri South. The record describes planned works and expected disruption, not completed repairs.",
    sourceCount: 2,
  },
  {
    stateId: "NG-DE",
    lga: "Ughelli North",
    category: "health",
    subcategory: "health_services",
    severity: 2,
    title: "Delta health outreach begins in Ughelli North",
    summary:
      "A demo outreach programme has begun in Ughelli North. No outbreak or official health alert is reported.",
    sourceCount: 2,
  },
  {
    stateId: "NG-AK",
    lga: "Eket",
    category: "economy",
    subcategory: "local_content",
    severity: 2,
    title: "Eket service companies review local hiring plan",
    summary:
      "A demo forum in Eket reviewed a local hiring plan for service companies. The record describes discussion and does not verify job numbers.",
    sourceCount: 2,
  },
  {
    stateId: "NG-AK",
    lga: "Uyo",
    category: "politics",
    subcategory: "public_administration",
    severity: 1,
    title: "Akwa Ibom assembly considers water agency report",
    summary:
      "A demo committee report on a water agency was considered by the Akwa Ibom assembly. No final resolution or funding decision is reported.",
    sourceCount: 1,
  },
];

export const NATIONAL_SCENARIOS: readonly DemoScenario[] = [
  {
    stateId: null,
    lga: null,
    category: "economy",
    subcategory: "food_security",
    severity: 2,
    title: "National food security coordination framework opens for consultation",
    summary:
      "A demo federal consultation has opened on a food security coordination framework. The record describes a consultation process, not an approved policy or funding commitment.",
    sourceCount: 2,
  },
  {
    stateId: null,
    lga: null,
    category: "environment",
    subcategory: "flood_preparedness",
    severity: 3,
    title: "Seasonal flood preparedness guidance issued to states",
    summary:
      "A demo national bulletin outlines seasonal flood preparedness guidance for state authorities. It is a planning notice, not a declaration that flooding is occurring.",
    sourceCount: 3,
    official: true,
  },
  {
    stateId: null,
    lga: null,
    category: "health",
    subcategory: "vaccination",
    severity: 2,
    title: "Federal health agency outlines immunisation review",
    summary:
      "A demo federal health desk has outlined an immunisation programme review. No outbreak or change in public health guidance is reported.",
    sourceCount: 2,
    official: true,
  },
  {
    stateId: null,
    lga: null,
    category: "infrastructure",
    subcategory: "power",
    severity: 3,
    title: "National electricity grid performance review scheduled",
    summary:
      "A demo system coordination review is scheduled to examine grid performance. The record describes a review and does not report a current outage or generation figure.",
    sourceCount: 2,
  },
  {
    stateId: null,
    lga: null,
    category: "security",
    subcategory: "coordination",
    severity: 3,
    title: "Security coordination meeting scheduled on inter-state cooperation",
    summary:
      "A demo coordination meeting is scheduled to discuss inter-state security cooperation. No operation, incident or outcome is confirmed.",
    sourceCount: 2,
    official: true,
  },
];

export const ALL_SCENARIOS: readonly DemoScenario[] = [
  ...PRIMARY_SCENARIOS,
  ...EXTRA_SCENARIOS,
  ...NATIONAL_SCENARIOS,
];
