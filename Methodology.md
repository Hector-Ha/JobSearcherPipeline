## The Nuclear Option: Comprehensive Market-Dominance Protocol for Job Acquisition in Ontario and British Columbia

## 1. Executive Summary and Operational Doctrine

### 1.1 The Philosophy of the Nuclear Option

The contemporary digital labour market is an adversarial environment characterized by information asymmetry. Job seekers typically operate within the "Surface Web" of employment—relying on major aggregators like LinkedIn, Indeed, and Glassdoor. These platforms, while massive, represent a curated, delayed, and often algorithmic distortion of the true demand for labour. They act as gatekeepers, monetizing access to listings that originated elsewhere, often introducing a propagation delay of 24 to 72 hours. In a competitive market like Toronto or Vancouver, this delay is often the difference between a resume being reviewed and a resume being discarded.

The "Nuclear Option" is not merely a search strategy; it is a fundamental shift in operational doctrine from passive consumption to active Open-Source Intelligence (OSINT) gathering. The objective is to bypass the aggregator layer entirely and interface directly with the primary data sources: the Applicant Tracking Systems (ATS), the government portals, the niche community boards, and the raw code repositories where hiring intent is first signaled. By indexing the entire available employment landscape of Ontario and British Columbia—from the "Big Tech" giants using Greenhouse to the Canadian SMBs using Collage HR—we establish a protocol for total market coverage.

This report provides an exhaustive, forensic mapping of the Canadian digital labour market. It dissects the internet into layers of accessibility and provides the precise Boolean search strings—the "Google Dorks"—required to extract job data at the source. This methodology ensures access to the "Hidden Job Market," capturing opportunities that exist on a company's internal server but have not yet propagated to the public aggregators.

### 1.2 The Architecture of Canadian Hiring

To execute this protocol effectively, one must understand the fragmented data silos that constitute the Canadian employment landscape. Unlike the United States, which is heavily consolidated around a few major platforms, Canada’s digital HR infrastructure is a hybrid of global enterprise standards and domestic sovereign software.

1. **The Global ATS Layer:** High-growth tech companies and large multinationals operating in Toronto and Vancouver typically utilize best-in-class global platforms such as Greenhouse, Lever, and Ashby. These systems are designed for high-volume recruitment and offer predictable URL structures that are easily exploited via search engine manipulation.   
    
2. **The Enterprise Layer:** Legacy giants—Canadian banks (RBC, TD), telecommunications firms (Rogers, Telus, Bell), and utilities—rely on heavy, complex Enterprise Resource Planning (ERP) modules like Workday, Taleo, and SAP SuccessFactors. These systems are notoriously difficult to index due to their use of dynamic AJAX loading and "black box" candidate portals.   
    
3. **The Sovereign Canadian Layer:** A distinct feature of the domestic market is the prevalence of Canadian-built HR software. Platforms like Collage HR, Humi (now Employment Hero), and BambooHR dominate the Small-to-Medium Business (SMB) sector. Standard global search strategies often miss these domains because they are less optimized for US-centric aggregators.   
    
4. **The Public Sector Deep Web:** Government hiring in Canada functions as a closed ecosystem. Federal, Provincial, and Municipal entities operate standalone portals that do not consistently push data to external boards. Finding these roles requires specific knowledge of "inventory" mechanisms and "casual pools".   
    
5. **The Technical Underground:** Finally, the most lucrative technical roles are often discussed in "Grey Web" environments—Slack communities, GitHub repositories, and private forums—before they ever reach a job board.   
    

This report is structured to systematically dismantle each of these layers, providing the reader with the tools to construct a daily reconnaissance routine that leaves no node of the network unchecked.

---

## 2. The Mega-Aggregators: X-Ray Protocols

While the Nuclear Option prioritizes direct-source access, the mega-aggregators (Google Jobs, LinkedIn, Indeed) remain useful for their sheer volume of data. However, using their native search interfaces is inefficient. Native search bars utilize "fuzzy logic" designed to maximize user engagement and ad revenue rather than precision. They hide results to sell promoted listings and often fail to support complex boolean logic.

To utilize these platforms effectively, we must "X-Ray" them—using Google to search _through_ the platform’s external index, forcing it to reveal the raw data without the algorithmic filtering.

### 2.1 The Google Jobs "API" Hack

Google Jobs is the largest aggregator in existence, scraping data from almost every other job board. However, its user interface is restrictive. The most effective method is to use strict Boolean operators to force exact matches within the page titles of indexed job postings.

**The Strategic Logic:** Job postings almost always follow a titling convention: `- [Location] - [Company]`. By targeting the `intitle:` operator, we filter out the noise of blog posts _about_ jobs and target the listings themselves.

**The Master Aggregator String (Ontario/BC Focus):** This string is designed to sweep the widest possible net across generic platforms while aggressively filtering for your target locations.

(intitle:"software engineer" OR intitle:"developer" OR intitle:"product manager" OR intitle:"data scientist" OR intitle:"analyst") ("Toronto" OR "Vancouver" OR "Ontario" OR "British Columbia" OR "Remote") -intitle:jobs -intitle:careers -site:linkedin.com -site:indeed.com -site:glassdoor.ca

**Deconstruction and nuance:**

- `(intitle:"..." OR...)`: This forces Google to only return pages where the job title appears in the HTML `<title>` tag. This is the highest-fidelity signal for a job posting.
    
- `("Toronto" OR "Vancouver"...)`: This limits the scope to the target economic zones. Note the inclusion of "Remote," which is critical for accessing the distributed workforce that may be based in these provinces but working for US entities.
    
- `-intitle:jobs -intitle:careers`: This negative filter removes "index" pages—the pages that list _all_ jobs at a company—so that the search results only show _specific_ individual job postings.
    
- `-site:linkedin.com...`: We exclude the major aggregators here because we will target them individually with specialized X-Ray strings later. This prevents result clutter.
    

### 2.2 LinkedIn X-Ray (The "Backdoor" Access)

LinkedIn's internal search is often capped at 1,000 results and heavily biased toward "Promoted" jobs. Furthermore, many recruiters post jobs that appear on public LinkedIn pages but do not appear in the internal search due to indexing lag. Google indexes these public pages faster than LinkedIn's internal engine updates its search cache for non-paying users.

**The Protocol:** LinkedIn job postings live in a specific subdirectory: `ca.linkedin.com/jobs/view`. By restricting our search to this path, we eliminate profiles, company pages, and articles.

**The Nuclear LinkedIn String:** site:[ca.linkedin.com/jobs/view](https://ca.linkedin.com/jobs/view) ("Toronto" OR "Vancouver") ("Python" OR "Java" OR "React" OR "Manager") "posted * hours ago"

**Insight and Optimization:**

- **The Wildcard Date Hack:** The phrase `"posted * hours ago"` utilizes Google’s wildcard operator (`*`). Google recognizes this pattern in the text snippet of the LinkedIn page. This is a powerful heuristic to filter for _freshness_ without relying on Google’s imperfect "Date" filter tool. It will surface jobs posted "2 hours ago," "14 hours ago," etc.
    
- **Subdomain Targeting:** Using `ca.linkedin.com` specifically targets the Canadian localized version of the site, ensuring the currency is CAD and the legal jurisdiction is Canada.
    

### 2.3 The "Review Site" Leak (Glassdoor & Indeed)

Candidates often neglect Glassdoor as a primary search engine, viewing it only as a reputation research tool. However, Glassdoor’s job board is robust and often contains listings scraped from unexpected sources. Similarly, Indeed’s sheer volume makes it necessary to X-Ray.

**Glassdoor X-Ray String:** site:glassdoor.ca/job-listing ("Toronto" OR "Vancouver") ("Tech" OR "Finance" OR "Admin")

**Indeed X-Ray String:** site:[ca.indeed.com/viewjob](https://ca.indeed.com/viewjob) ("Toronto" OR "Vancouver") ("Engineer" OR "Manager")

**Strategic implication:** These strings are "fail-safes." They are designed to catch the "long-tail" of jobs—roles at companies that may not have a sophisticated ATS but posted a manual listing on Indeed or Glassdoor that got indexed.

---

## 3. The Global ATS Layer: "Big Tech" and High-Growth Startups

This is the most critical section of the Nuclear Option. The vast majority of high-value, high-salary roles in the Toronto and Vancouver tech sectors are hosted on third-party Applicant Tracking Systems (ATS). These systems—Greenhouse, Lever, Ashby—host the "canonical" version of the job posting.

When a company posts a job, it appears here at **T=0**. It may not appear on LinkedIn until **T+24h** or **T+48h**. By monitoring these domains directly, you gain a temporal advantage, allowing you to be among the first applicants.

### 3.1 The "Greenhouse" Ecosystem

Greenhouse is the status symbol of the modern tech company. It is the dominant ATS for North American "Unicorns," Series-B+ startups, and established tech giants. If a company is venture-backed and hiring in Canada, there is a greater than 80% probability they use Greenhouse.   

**URL Structure:** Greenhouse job boards invariably live at `boards.greenhouse.io`. This predictability allows for surgical precision in search.

**The Nuclear Greenhouse String (Canada Focus):** site:boards.greenhouse.io ("Location: Toronto" OR "Location: Vancouver" OR "Location: Remote" OR "Toronto, ON" OR "Vancouver, BC") ("Engineer" OR "Manager" OR "Analyst" OR "Director")

**Analysis of the String:**

- **"Location: Toronto":** Greenhouse pages structure their location data with the prefix "Location:". By including this prefix in quotes, we eliminate false positives (e.g., a blog post on a company site _mentioning_ a Toronto office) and ensure we only find actual active job listings.
    
- **The "Orphan Page" Phenomenon:** Greenhouse pages often remain live and accessible via Google even after the company has removed the link from their main careers page or LinkedIn. These are "Zombie" or "Orphan" reqs. **Crucially**, if the "Apply" button is still active on the Greenhouse page, the application will still enter the database. This allows you to apply to roles that are technically "closed" to the general public but not yet deleted from the system.
    

### 3.2 The "Lever" Ecosystem

Lever is the primary competitor to Greenhouse, favored by slightly smaller or design-centric tech companies. Its URL structure `jobs.lever.co` is equally predictable.

**The Nuclear Lever String:** site:jobs.lever.co ("Toronto" OR "Vancouver" OR "British Columbia" OR "Ontario") ("Software" OR "Product" OR "Sales" OR "Marketing")

**Nuance:** Lever is distinct in that it often categorizes remote roles with specific tags like "Remote - Canada". To capture these, one should append a variation: site:jobs.lever.co "Remote" "Canada"

### 3.3 The "Ashby" Anomaly (The New Guard)

In the last 24 months, **Ashby** has rapidly become the ATS of choice for YC-backed startups and modern "hyper-growth" companies. Companies like Notion, Deel, and many emerging Canadian startups have migrated to Ashby.   

**Strategic Importance:** Ashby is currently the "signal" for a modern, well-funded startup. If a company uses Ashby, they are likely culturally modern, offer equity, and operate with high velocity. Older aggregators often struggle to scrape Ashby efficiently because of its React-heavy front end.

**The Nuclear Ashby String:** site:jobs.ashbyhq.com ("Toronto" OR "Vancouver" OR "Canada" OR "Remote")

**High-Value Filter:** Ashby job descriptions are notoriously detailed regarding tech stacks. You can filter for specific high-value keywords easily here.

- _Example:_ `site:jobs.ashbyhq.com "Toronto" ("Rust" OR "Elixir" OR "Generative AI")`
    

### 3.4 The "Workable" Cluster

Workable is a mid-market ATS used by many agencies and medium-sized businesses in Canada. It often hosts roles for non-tech industries that are modernizing, such as digital agencies, marketing firms, and light manufacturing.   

**The Nuclear Workable String:** site:apply.workable.com ("Toronto" OR "Vancouver") _Note:_ Some older Workable boards use `workable.com/j/`, so a secondary string is useful: `site:workable.com/j/ ("Toronto" OR "Vancouver")`.

### 3.5 The SmartRecruiters Network

SmartRecruiters is a favored platform for large-scale Canadian enterprises that are not banks but have complex hiring needs. Notable users include the **Torstar Group** (Toronto Star), **Ontario Transit Group**, and major hospitality groups like **Oliver & Bonacini**.   

**The Nuclear SmartRecruiters String:** site:careers.smartrecruiters.com ("Toronto" OR "Vancouver" OR "ON" OR "BC")

**Sector Insight:** This string is particularly effective for candidates looking for roles in **media, journalism, transportation infrastructure, and high-end hospitality management** in Toronto.

---

## 4. The Enterprise Layer: Penetrating the "Black Boxes"

Large enterprises—banks, insurance companies, and multinationals—utilize heavy, legacy systems like Workday, iCIMS, and Taleo. These systems are "Black Boxes." They typically require a login to view full details, use dynamic page loading (which confuses simple scrapers), and often host thousands of jobs globally, making location filtering essential.

### 4.1 The "Workday" Barrier

Workday is the behemoth of the corporate world. It is used by the **City of Vancouver** , the **University of British Columbia (UBC)** , and almost every major Canadian bank.   

**The Challenge:** Workday implementations are usually subdomained by the company (e.g., `cov.wd5.myworkdayjobs.com`). However, the root domain `myworkdayjobs.com` is universal.

**The Nuclear Workday String:** site:myworkdayjobs.com ("Toronto" OR "Vancouver") "job" -intitle:login

**Optimization Strategy:** Because Workday is used by massive organizations, this string will return tens of thousands of results. It is _essential_ to add specific job titles to this string to make it actionable.

- _Refined:_ `site:myworkdayjobs.com ("Toronto" OR "Vancouver") ("Project Manager" OR "Financial Analyst")`
    

**The "User Experience" Arbitrage:** Workday is infamous for its poor candidate experience (forcing users to create accounts, re-enter resume data, etc.). This creates a high drop-off rate. Many candidates abandon the application halfway through.

- **Insight:** If you master the Workday application flow—optimizing your resume for its specific parser—you gain a statistical advantage simply by being one of the few who completes the process. The barrier to entry acts as a filter for your competition.
    

### 4.2 The iCIMS and Jobvite Cluster (Healthcare & Retail)

iCIMS  and Jobvite  are the standard for the healthcare and retail sectors. **Vancouver Coastal Health**  and major retail chains utilize these platforms.   

**The Nuclear Healthcare/Retail String:** (site:jobs.jobvite.com OR site:icims.com) ("Toronto" OR "Vancouver" OR "Canada") ("Nurse" OR "Sales Associate" OR "Store Manager" OR "Pharmacist")

**Application Nuance:** These platforms often have "Talent Networks" or "General Interest" applications. For healthcare specifically, joining these talent pools is often more effective than applying to a single requisition, as recruiters pull from the pool to fill shift-based roles.

---

## 5. The Sovereign Canadian Layer: The SMB "Shield"

A significant portion of the Canadian economy operates on software built in Canada, for Canada. These platforms—Collage HR, BambooHR, Humi—are often ignored by US-centric scraping bots, meaning jobs posted here face less competition from international applicants.

### 5.1 Collage HR

Collage is a Toronto-based HR platform used by hundreds of Canadian SMBs. It is particularly popular among marketing agencies, design firms, and small tech consultancies.   

**The Nuclear Collage String:** site:collage.co ("Toronto" OR "Vancouver" OR "Remote")

### 5.2 BambooHR

While US-based, BambooHR is widely cited as the top choice for Canadian SMBs. It serves as the "default" ATS for companies with 50-500 employees.   

**The Nuclear BambooHR String:** site:[bamboohr.com/jobs](https://bamboohr.com/jobs) ("Toronto" OR "Vancouver" OR "Ontario" OR "British Columbia") _Note:_ This string is exceptionally powerful because BambooHR pages are simple HTML, meaning Google indexes them perfectly. You will often find roles here that appear _nowhere_ else.

### 5.3 Humi / Employment Hero

Humi (recently rebranded under Employment Hero) is another major player in the domestic HR space. It is the ATS of choice for companies that want an "All-in-One" Canadian payroll and HR solution.   

**The Nuclear Humi String:** (site:humi.ca OR site:employmenthero.com) ("careers" OR "jobs") ("Toronto" OR "Vancouver")

---

## 6. The Startup Ecosystem: Incubators, Accelerators, and Hubs

Canada’s tech sector is centralized around key innovation "Hubs." These organizations do not just house startups; they aggregate their job postings. These aggregated boards are goldmines for high-quality, high-equity technical roles.

### 6.1 MaRS Discovery District (Toronto)

MaRS is North America's largest urban innovation hub. Their job board uses the "Getro" platform  and lists thousands of roles from their tenant companies (e.g., Layer 6 AI, Rippling).   

**Direct Access:** `https://techjobs.marsdd.com/` **The Backdoor String:** site:techjobs.marsdd.com "Toronto" ("Senior" OR "Lead")

**Insight:** The MaRS board allows filtering by company size and funding stage. This is critical for assessing risk. A job at a "Seed" stage company carries different risks and rewards than one at a "Series C" company.

### 6.2 Communitech (Waterloo/Toronto Corridor)

Communitech serves the Waterloo tech ecosystem—often called the "Silicon Valley of the North." While physically in Waterloo, the labor market overlaps heavily with Toronto (many companies have offices in both).

**Direct Access:** `https://www1.communitech.ca/jobs`  **The Backdoor String:** site:communitech.ca/jobs ("Toronto" OR "Waterloo")   

### 6.3 BC Tech Association (Vancouver)

The BC Tech board aggregates roles for the Vancouver and Victoria tech scenes.   

**Direct Access:** `https://www.bcjobs.ca/` **The Backdoor String:** site:bcjobs.ca ("Software" OR "Tech") "Vancouver"

### 6.4 The "Getro" Network Hack

Many Canadian accelerators (like MaRS and Communitech) use a white-label platform called **Getro** to run their job boards. We can exploit this common infrastructure to find _other_ unlisted accelerators or Venture Capital portfolios that use the same tech.

**The Super-Hack String:** "powered by Getro" ("Toronto" OR "Vancouver") -site:getro.com

**Why this is nuclear:** This string searches for the footer text "Powered by Getro" on any website in your target cities. It effectively uncovers niche VC job boards (e.g., a specific Venture Capital firm's portfolio job board) that you would never find otherwise.

---

## 7. The Public Sector Deep Web: Government & Education

Government hiring is a distinct discipline. These roles offer stability and pensions, but the application process is bureaucratic. The data is rarely pushed to Indeed; you must go to the source.

### 7.1 The Federal Government of Canada

The primary portal is `jobs.gc.ca`. However, the "Nuclear" approach involves searching for "Casual" or "Term" postings and "Inventories."   

**The Mechanism of "Inventories":** The Federal government often posts "Anticipatory Inventories." These are not for a specific open job, but to build a pool of qualified candidates. When a manager needs to hire, they pull from this pool _before_ posting a public job. **Getting into the inventory is the job search.**

**Direct Portal:** `https://www.canada.ca/en/services/jobs/opportunities/government.html`

**The Nuclear Federal String:** site:canada.ca/en/services/jobs ("CS-01" OR "CS-02" OR "EC-04" OR "AS-03" OR "IT-01") ("Inventory" OR "Pool")

- _Classification Codes:_ Use the specific codes: **CS/IT** (Computer Systems), **EC** (Economics/Social Science), **AS** (Administrative Services), **PM** (Program Management). Knowing your code is the key to federal search.   
    

### 7.2 Provincial Governments (ON & BC)

- **Ontario Public Service (OPS):**
    
    - **Portal:** `www.gojobs.gov.on.ca`.   
        
    - **String:** `site:gojobs.gov.on.ca "Toronto" "Policy"`.
        
    - _Note:_ OPS jobs have strict closing times (often 11:59 PM EST).
        
- **BC Public Service:**
    
    - **Portal:** `www2.gov.bc.ca/gov/content/careers-myhr`.   
        
    - **String:** `site:gov.bc.ca "job posting" "Vancouver"`.
        

### 7.3 The Municipal Layer (Cities)

Cities are massive employers. Their hiring is often decentralized and uses heavy ATS systems.

- **City of Toronto:** Uses a custom SuccessFactors/Taleo portal `jobs.toronto.ca`.   
    
    - _String:_ `site:jobs.toronto.ca`
        
- **City of Vancouver:** Uses Workday.   
    
    - _String:_ `site:cityofvancouver.wd5.myworkdayjobs.com`
        
- **City of Mississauga:** Uses `jobs.mississauga.ca`.   
    
- **City of Ottawa:** Uses `jobs-emplois.ottawa.ca`.   
    
- **City of Burnaby:** Uses Taleo.   
    
    - _String:_ `site:tre.tbe.taleo.net "Burnaby"`
        

### 7.4 The Academic Sector (Universities)

Universities (U of T, UBC, Waterloo, York) function like small cities. They employ IT staff, facility managers, administrators, and researchers.

- **University of Toronto:** `jobs.utoronto.ca`.
    
- **UBC:** `wd10.myworkdayjobs.com/ubcstaffjobs`.   
    
- **University of Waterloo:** `uwaterloo.ca/hire`.   
    

**The Nuclear Academic String:** (site:utoronto.ca OR site:ubc.ca OR site:uwaterloo.ca OR site:yorku.ca) ("careers" OR "jobs") -inurl:student

---

## 8. The Hidden Technical Layer: The Grey Web

For technical roles, the "best" jobs are often filled via network before they ever hit a job board. However, we can use OSINT to simulate "being in the network."

### 8.1 GitHub "Hiring" Search

Engineers often bypass HR completely and put "We are hiring" directly in their GitHub bios or repository Readmes. This signals a team that is engineering-led and likely despises traditional recruiting.

**The GitHub String:** site:github.com "we are hiring" ("Toronto" OR "Vancouver") language:Python

**Interpretation:** This searches the _entire_ GitHub domain for users or repositories located in your target cities who explicitly state they are hiring. This is a high-yield tactic for finding early-stage startups or open-source projects with funding.

### 8.2 Slack Communities (Archives & Access)

Tech communities often have dedicated Slack workspaces with `#jobs` channels. While Google cannot index inside a private Slack, it _can_ index the public archives or the sign-up pages.

- **TorontoJS:** A massive community of JavaScript developers in Toronto.   
    
    - _Access:_ `torontojs.com` -> Join Slack -> `#jobs` channel.
        
    - _Archive Search:_ `site:torontojs.com "jobs"`
        
- **Vancouver Tech Journal:** Maintains a Slack community and a job board.   
    
    - _Access:_ `vantechjournal.com` -> Slack.
        

**Strategy:** Join these communities. Do not just lurk. Set up keyword alerts inside Slack (e.g., "Hiring", "Junior", "React") so you are pinged the second a founder posts a message.

---

## 9. The Agency Archipelago

Recruitment agencies are a double-edged sword. "Big Box" agencies operate on volume, while "Boutique" agencies operate on relationships. You need both in your ecosystem.

### 9.1 The "Big Box" Agencies

Firms like **Randstad**, **Robert Half**, and **Insight Global**  have massive databases. They are excellent for contract roles (6-12 month terms) at large banks or government entities.   

- **Randstad String:** `site:randstad.ca/jobs "Toronto"`
    
- **Robert Half String:** `site:roberthalf.com "Toronto" "Technology"`
    

### 9.2 The Boutique & Niche Specialists

These are the "Headhunters." They often have exclusive contracts with startups or specific tech firms.

- **GuruLink:** Highly specialized in the Toronto tech scene. Their search string `app.gurulink.ca` often reveals roles not listed elsewhere.   
    
- **Kovasys:** Specializes in IT recruitment across Toronto and Montreal.   
    
- **Altis Recruitment:** Strong focus on Government and Professional Services.   
    

**Agency Strategy:** Do not apply to agency jobs blindly. Instead, use the job posting to identify the _recruiter_ managing the role, then contact them directly on LinkedIn. The agency is the gatekeeper; build a relationship with the gatekeeper.

---

## 10. The Daily Execution Protocol: The "Nuclear" Routine

To operationalize this intelligence, you cannot simply run every string every day—that leads to burnout. You must adopt a rotating "Wave" schedule that prioritizes high-velocity sources while maintaining coverage of slower sectors.

### Phase 1: The "Fresh Catch" (Daily - 09:00 AM)

_Goal: Catch roles posted in the last 24 hours on major platforms to maximize early-applicant advantage._

1. **Run Google Jobs Fresh Index:**
    
    - `(intitle:"software engineer") ("Toronto" OR "Vancouver") -site:linkedin.com after:2026-02-08`
        
    - _Action:_ Scan titles. Open new tabs.
        
2. **Run LinkedIn X-Ray Fresh:**
    
    - `site:ca.linkedin.com/jobs/view ("Toronto" OR "Vancouver") "posted * hours ago"`
        
    - _Action:_ Sort by "Date" in Google tools if possible, or visually scan for "posted 1 hour ago".
        

### Phase 2: The "Big ATS" Sweep (Daily - 09:30 AM)

_Goal: Hit the source of truth for 80% of tech jobs._

1. **Run the Unified ATS String:**
    
    - `(site:boards.greenhouse.io OR site:jobs.lever.co OR site:jobs.ashbyhq.com) ("Toronto" OR "Vancouver")`
        
    - _Action:_ Filter results to "Past 24 hours" using Google's Tools menu.
        

### Phase 3: The "Sovereign" Sweep (Tuesday/Thursday)

_Goal: Target Canadian SMBs and mid-market firms._

1. **Run the Canadian ATS String:**
    
    - `(site:bamboohr.com/jobs OR site:collage.co OR site:humi.ca) ("Toronto" OR "Vancouver")`
        

### Phase 4: The Public Sector Deep Dive (Wednesday)

_Goal: Monitor slow-moving Government and University Enterprise roles._

1. **Run the Gov/Edu String:**
    
    - `(site:jobs.gc.ca OR site:gojobs.gov.on.ca OR site:jobs.toronto.ca OR site:myworkdayjobs.com) ("Toronto" OR "Vancouver")`
        
    - _Action:_ Look for "Inventory" or "Pool" postings specifically.
        

### Phase 5: The "Hidden" & Agency Layer (Friday)

_Goal: Niche finds, recruiter connections, and weekend preparation._

1. **Run the Getro/Agency String:**
    
    - `("powered by Getro" OR site:randstad.ca OR site:gurulink.ca) ("Toronto" OR "Vancouver")`
        
2. **Check Slack Communities:**
    
    - Review `#jobs` channels in TorontoJS / Vancouver Tech for the week's summary.
        

### 10.1 Alert Automation

Do not type these manually every day.

1. **Google Alerts:** specific strings (especially the ATS ones) can be set as Google Alerts.
    
2. **VisualPing:** Use a tool like VisualPing.io to monitor specific pages (like `jobs.gc.ca` or `techjobs.marsdd.com`) for visual changes.
    

## Conclusion

The "Nuclear Option" is a protocol of attrition and precision. By utilizing the Boolean strings provided, you effectively index the internet's employment data yourself, removing the reliance on third-party algorithms. You move from a passive participant in the labour market to an active operator, seeing opportunities at their genesis (T=0) rather than their distribution (T+48h).

In the constrained and competitive markets of Toronto and Vancouver, information is the primary leverage. This report provides the keys to the entire city's data. It is now up to the operator to execute.