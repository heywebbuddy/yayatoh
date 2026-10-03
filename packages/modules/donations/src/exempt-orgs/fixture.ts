/**
 * The recorded IRS exempt-organization fixture (M4.8b): rows in the exact layout of the IRS
 * Exempt Organizations Business Master File extract (`eo1.csv`…`eo4.csv`, header included), for
 * dev, CI and e2e. Invented organizations and EINs (no real charity's data), covering every case
 * the staff review shows: an eligible 501(c)(3) (subsection 03, deductibility 1), a fiscal sponsor,
 * a 501(c)(4) (not deductible), and a revoked status. The real list is the owner-run download
 * (`apps/worker/scripts/irs-exempt-list.ts`); tests never call the IRS.
 */
export const RECORDED_EO_BMF_CSV = `"EIN","NAME","ICO","STREET","CITY","STATE","ZIP","GROUP","SUBSECTION","AFFILIATION","CLASSIFICATION","RULING","DEDUCTIBILITY","FOUNDATION","ACTIVITY","ORGANIZATION","STATUS","TAX_PERIOD","ASSET_CD","INCOME_CD","FILING_REQ_CD","PF_FILING_REQ_CD","ACCT_PD","ASSET_AMT","INCOME_AMT","REVENUE_AMT","NTEE_CD","SORT_NAME"
"123456789","LAKESIDE COMMUNITY FOUNDATION","","100 LAKE ST","CHICAGO","IL","60601-0000","0000","03","3","1000","199501","1","15","000000000","1","01","202312","5","5","01","0","12","1250000","640000","610000","T31",""
"234567891","HARBOR ARTS ALLIANCE","","1 PIER WAY","BOSTON","MA","02110-0000","0000","03","3","1200","200307","1","15","000000000","1","01","202306","4","4","01","0","06","420000","190000","185000","A20",""
"345678912","GOOD CAUSE FISCAL SPONSOR INC","","55 SPONSOR AVE","NEW YORK","NY","10001-0000","0000","03","3","1000","199812","1","15","000000000","1","01","202312","6","6","01","0","12","5300000","2100000","2050000","T50",""
"456789123","NEIGHBORS CIVIC LEAGUE","","9 MAIN ST","DENVER","CO","80202-0000","0000","04","3","1000","201104","2","00","000000000","1","01","202312","3","3","01","0","12","80000","40000","39000","W24",""
"567891234","FORMER HELPERS FUND","","2 OLD RD","AUSTIN","TX","78701-0000","0000","03","3","1000","200001","4","15","000000000","1","20","201912","2","2","01","0","12","10000","5000","5000","P20",""
"678912345","ROSEWOOD SCHOLARSHIP TRUST","","7 ROSE LN","PORTLAND","OR","97201-0000","0000","03","3","1000","201609","1","16","000000000","2","01","202312","4","4","01","1","12","350000","90000","88000","B82",""
`;
