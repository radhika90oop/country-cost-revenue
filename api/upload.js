const express = require("express");
const multer = require("multer");
const path = require("path");
// const { Parser } = require("json2csv");
const fs = require("fs");
// const XLSX = require("xlsx");
const ExcelJS = require("exceljs");

function splitItemsWithNewline(array) {
  const result = [];
  array.forEach((item) => {
    if (item.includes("\n")) {
      result.push(...item.split("\n"));
    } else {
      result.push(item);
    }
  });
  return result;
}

function sumCostsByCountry(data) {
  const result = {};

  data.forEach(({ country, cost }) => {
    if (!result[country]) {
      result[country] = 0;
    }
    result[country] += parseFloat(cost);
  });

  return Object.entries(result).map(([country, totalCost]) => ({
    country,
    cost: totalCost.toFixed(2), // Format the cost to 2 decimal places
  }));
}

const app = express();
const upload = multer({ dest: "/tmp/uploads/" });

// Serve static files
app.use(express.static("public"));

// Endpoint to handle file upload
app.post(
  "/api/upload",
  upload.fields([{ name: "file1" }, { name: "file2" }]),
  async (req, res) => {
    try {
      const { file1, file2 } = req.files;
      let { rate } = req.body;

      if (!Number(rate)) {
        return res.status(400).send("Rate is required");
      }

      if (!file1 || !file2) {
        return res.status(400).send("Both files are required.");
      }

      const getNoOfColumns = async (file) => {
        const filePath = file[0].path;
        const ext = path.extname(file[0].originalname).toLowerCase();
        if (ext === ".csv") {
          let content = fs.readFileSync(filePath, "utf8");
          return content.split("\n")?.[0]?.split("\t")?.length;
        } else {
          throw new Error("Unsupported file type.");
        }
      };

      const indexOfIncludes = (arr, str) => {
        for (i = 0; i < arr.length; i++) {
          if (arr[i].endsWith(str)) {
            return i;
          }
        }
      };

      const convertToJson1 = async (file, dataChunck) => {
        const filePath = file[0].path;
        const ext = path.extname(file[0].originalname).toLowerCase();
        if (ext === ".csv") {
          let content = fs
            .readFileSync(filePath, "utf8")
            ?.replaceAll("\r\n", "")
            ?.replaceAll(",", "")
            ?.replaceAll("\t", ",")
            ?.split(",");
          let data = content.map((x) => {
            return x.replaceAll("\x00", "");
          });
          let rows = [];
          const chunkSize = dataChunck - 1;
          for (let i = 0; i < data.length; i += chunkSize) {
            const chunk = data.slice(i, i + chunkSize);
            rows.push(chunk);
          }
          let countryIndex = indexOfIncludes(
            rows[0],
            "Country/Territory (Matched)"
          );
          let costIndex = indexOfIncludes(rows[0], "Cost");
          let countryCost = [];
          for (let i = 0; i < rows.length; i++) {
            let obj = {
              country: rows[i]?.[countryIndex],
              cost: rows[i]?.[costIndex],
            };
            countryCost.push(obj);
          }
          countryCost.shift();
          countryCost = sumCostsByCountry(countryCost);
          return countryCost;
        } else {
          throw new Error("Unsupported file type.");
        }
      };

      const convertToJson2 = async (file, dataChunck) => {
        const filePath = file[0].path;
        const ext = path.extname(file[0].originalname).toLowerCase();
        if (ext === ".csv") {
          let content = fs
            .readFileSync(filePath, "utf8")
            //?.replaceAll("\n", "")
            ?.replaceAll(",", "")
            ?.replaceAll("\t", ",")
            ?.split(",");
          let data = content.map((x) => {
            return x.replaceAll("\x00", "");
          });
          data = splitItemsWithNewline(data);
          let rows = [];
          const chunkSize = dataChunck;
          for (let i = 0; i < data.length; i += chunkSize) {
            const chunk = data.slice(i, i + chunkSize);
            rows.push(chunk);
          }
          let countryIndex = indexOfIncludes(rows[0], "Country");
          let revenueIndex = indexOfIncludes(rows[0], "Est. earnings (USD)");
          let eCPMIndex = indexOfIncludes(rows[0], "Observed eCPM (USD)");
          let countryRevenue = [];
          for (let i = 0; i < rows.length; i++) {
            let obj = {
              country: rows[i]?.[countryIndex],
              revenue: rows[i]?.[revenueIndex],
              eCPM: rows[i]?.[eCPMIndex],
            };
            countryRevenue.push(obj);
          }
          countryRevenue.shift();
          return countryRevenue;
        } else {
          throw new Error("Unsupported file type.");
        }
      };

      const data1Chunck = await getNoOfColumns(file1);
      const data2Chunck = await getNoOfColumns(file2);
      const data1 = await convertToJson1(file1, data1Chunck);
      const data2 = await convertToJson2(file2, data2Chunck);

      if (!data1[0]?.country || !data1[0]?.cost) {
        return res.status(400).send("country or cost field not found");
      }
      if (!data2[0]?.country || !data2[0]?.revenue) {
        return res.status(400).send("country or revenue field not found");
      }
      let data3 = [];
      for (let i = 0; i < data1.length; i++) {
        let revUSD = Number(
          data2.find((x) => x.country === data1[i].country)?.revenue || 0
        );
        let revINR = revUSD * Number(rate);
        let profitINR = revINR - data1[i].cost;
        let profitPer = Number(data1[i].cost)
          ? Number(
              Number(
                Number(Number(profitINR) / Number(data1[i].cost)) * 100
              ).toFixed(2)
            )
          : 0;
        let eCPMUSD = Number(
          data2.find((x) => x.country === data1[i].country)?.eCPM || 0
        );
        let data = {
          country: data1[i].country,
          costINR: data1[i].cost,
          revUSD,
          revINR,
          profitINR,
          profitPer,
          eCPMUSD,
        };
        if (data1[i].country && Number(data1[i].cost)) {
          data3.push(data);
        }
      }

      // Create a new workbook and add a worksheet
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Sheet1");
      worksheet.columns = [
        { header: "country", key: "country", width: 30 },
        { header: "costINR", key: "costINR", width: 10 },
        { header: "revUSD", key: "revUSD", width: 10 },
        { header: "revINR", key: "revINR", width: 10 },
        { header: "profitINR", key: "profitINR", width: 10 },
        { header: "profitPer", key: "profitPer", width: 10 },
        { header: "eCPMUSD", key: "eCPMUSD", width: 10 },
      ];

      // Add data to the worksheet
      data3.forEach((row) => worksheet.addRow(row));

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Skip header row

        const profitINRCell = row.getCell("profitINR");
        const profitPerCell = row.getCell("profitPer");

        if (profitINRCell.value > 0) {
          let fontGreen = {
            color: { argb: "56AE57" }, // Green font
            bold: true, // Optionally make the text bold
          };
          profitINRCell.font = fontGreen;
          profitPerCell.font = fontGreen;
        }
        if (profitINRCell.value < 0) {
          let fontRed = {
            color: { argb: "C23B22" }, // Green font
            bold: true, // Optionally make the text bold
          };
          profitINRCell.font = fontRed;
          profitPerCell.font = fontRed;
        }
      });

      // Define file path
      const filePath = path.join("/tmp", "output.xlsx");

      // Write the Excel file
      workbook.xlsx.writeFile(filePath).then(() => {
        // Send the file as a response
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
          "Content-Disposition",
          "attachment; filename=output.xlsx"
        );
        res.send(fs.readFileSync(filePath));
      });

      // const fields = Object.keys(data3[0]); // Extract fields from JSON
      // const json2csvParser = new Parser({ fields });
      // const csv = json2csvParser.parse(data3);

      // // Define file path
      // const filePath = path.join("/tmp", "output.csv");

      // // Save CSV to a file
      // fs.writeFileSync(filePath, csv);

      // // Send CSV file as a response
      // res.setHeader("Content-Type", "text/csv");
      // res.setHeader("Content-Disposition", "attachment; filename=output.csv");
      // res.send(csv);
    } catch (err) {
      console.error(err);
      res.status(500).send("Error processing files.");
    }
  }
);

app.listen(3000, () => {
  console.log("Server is running on http://localhost:3000");
});
