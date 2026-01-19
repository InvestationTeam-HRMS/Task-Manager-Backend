const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const outputDir = process.cwd();

async function createExcel(fileName, headers, rows) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');

    sheet.addRow(headers);
    rows.forEach(row => sheet.addRow(row));

    // Format headers
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
    };

    const filePath = path.join(outputDir, fileName);
    await workbook.xlsx.writeFile(filePath);
    console.log(`Generated: ${fileName}`);
}

async function run() {
    // 1. Client Groups
    await createExcel('client_groups_sample.xlsx',
        ['groupName', 'groupCode', 'country', 'status', 'remark'],
        [
            ["Global Enterprises", "GE-001", "USA", "ACTIVE", "Main global client group"],
            ["Infrastructure Solutions", "IS-002", "UK", "ACTIVE", "Infrastructure focus"],
            ["Asian Markets Corp", "AMC-003", "India", "ACTIVE", "Asian region group"]
        ]
    );

    // 2. Client Companies
    await createExcel('client_companies_sample.xlsx',
        ['companyName', 'companyCode', 'groupName', 'address', 'status', 'remark'],
        [
            ["GE Logistics", "GEL-101", "Global Enterprises", "New York, NY", "ACTIVE", "Logistics arm"],
            ["GE Tech Services", "GET-102", "Global Enterprises", "San Francisco, CA", "ACTIVE", "Tech services branch"],
            ["IS Construction", "ISC-201", "Infrastructure Solutions", "London, UK", "ACTIVE", "Construction division"],
            ["AMC Retail", "AMR-301", "Asian Markets Corp", "Mumbai, India", "ACTIVE", "Retail business"]
        ]
    );

    // 3. Client Locations
    await createExcel('client_locations_sample.xlsx',
        ['locationName', 'locationCode', 'companyName', 'address', 'status', 'remark'],
        [
            ["NY Warehouse", "NYW-01", "GE Logistics", "Bronx, NY", "ACTIVE", "East coast hub"],
            ["SF Office", "SFO-01", "GE Tech Services", "Market St, SF", "ACTIVE", "HQ Office"],
            ["London Site A", "LSA-01", "IS Construction", "Westminster", "ACTIVE", "Current active site"],
            ["Mumbai Store 1", "MBS-01", "AMC Retail", "Andheri West", "ACTIVE", "Flagship store"]
        ]
    );

    // 4. Sub Locations
    await createExcel('sub_locations_sample.xlsx',
        ['subLocationName', 'subLocationCode', 'locationName', 'companyName', 'address', 'status', 'remark'],
        [
            ["Zone A - East", "ZAE-001", "NY Warehouse", "GE Logistics", "Basement Level", "ACTIVE", "Sub section of warehouse"],
            ["Zone B - West", "ZBW-002", "NY Warehouse", "GE Logistics", "Ground Floor", "ACTIVE", "Sub section of warehouse"],
            ["Server Room", "SVR-01", "SF Office", "GE Tech Services", "Suite 500", "ACTIVE", "Main server room"],
            ["Sector 7", "SEC-07", "Mumbai Store 1", "AMC Retail", "Ground Floor", "ACTIVE", "Apparel section"]
        ]
    );

    // 5. Projects
    await createExcel('projects_sample.xlsx',
        ['projectName', 'projectNo', 'subLocationName', 'deadline', 'priority', 'status', 'remark'],
        [
            ["Warehouse Management", "P-101", "Zone A - East", "2026-12-31", "HIGH", "ACTIVE", "Inventory project"],
            ["Network Upgrade", "P-102", "Server Room", "2026-06-30", "CRITICAL", "ACTIVE", "Server room infra"],
            ["Retail Launch", "P-103", "Sector 7", "2026-08-15", "MEDIUM", "ACTIVE", "New store section"]
        ]
    );

    // 6. Team (Users/Members)
    await createExcel('teams_sample.xlsx',
        ['teamName', 'teamNo', 'email', 'phone', 'groupName', 'companyName', 'locationName', 'subLocationName', 'status', 'remark'],
        [
            ["John Doe", "U-101", "john.doe@ge.com", "+1234567890", "Global Enterprises", "GE Logistics", "NY Warehouse", "Zone A - East", "ACTIVE", "Logistics lead"],
            ["Jane Smith", "U-102", "jane.smith@ge.com", "+1987654321", "Global Enterprises", "GE Tech Services", "SF Office", "Server Room", "ACTIVE", "Tech lead"],
            ["Rahul Kumar", "U-103", "rahul@amc.com", "+919999999999", "Asian Markets Corp", "AMC Retail", "Mumbai Store 1", "Sector 7", "ACTIVE", "Retail manager"]
        ]
    );

    // 7. Groups (Departments/Internal Groups)
    await createExcel('groups_sample.xlsx',
        ['groupName', 'groupCode', 'groupNo', 'clientGroupName', 'companyName', 'locationName', 'subLocationName', 'status', 'remark'],
        [
            ["Logistics Ops", "LOG-01", "G-101", "Global Enterprises", "GE Logistics", "NY Warehouse", "Zone A - East", "ACTIVE", "Ops group"],
            ["IT Support", "ITS-01", "G-102", "Global Enterprises", "GE Tech Services", "SF Office", "Server Room", "ACTIVE", "Support group"],
            ["Sales Team", "SAL-01", "G-103", "Asian Markets Corp", "AMC Retail", "Mumbai Store 1", "Sector 7", "ACTIVE", "Apparel sales"]
        ]
    );

    // 8. IP Addresses
    await createExcel('ip_addresses_sample.xlsx',
        ['ipAddressName', 'ipAddress', 'ipNo', 'clientGroupName', 'companyName', 'locationName', 'subLocationName', 'status', 'remark'],
        [
            ["Main Gateway", "192.168.1.1", "I-101", "Global Enterprises", "GE Logistics", "NY Warehouse", "Zone A - East", "ACTIVE", "Primary GW"],
            ["Server IP", "10.0.0.5", "I-102", "Global Enterprises", "GE Tech Services", "SF Office", "Server Room", "ACTIVE", "Production server"],
            ["POS Terminal", "172.16.0.10", "I-103", "Asian Markets Corp", "AMC Retail", "Mumbai Store 1", "Sector 7", "ACTIVE", "Store POS"]
        ]
    );
}

run().catch(console.error);
